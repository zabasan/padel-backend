import type { HttpContext } from '@adonisjs/core/http'
import { currentCashSessionId } from '#services/cash_register'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import Product from '#models/product'
import Sale from '#models/sale'
import SaleItem from '#models/sale_item'
import {
  InsufficientStockError,
  applyStockMovement,
  lineSubtotal,
  paymentMatchesTotal,
  paymentSum,
  round2,
  saleTotal,
} from '#services/commerce'
import { logCommerce } from '#services/commerce_audit'

const saleValidator = vine.compile(
  vine.object({
    customerId: vine.number().positive().optional().nullable(),
    notes: vine.string().trim().maxLength(500).optional().nullable(),
    efectivo: vine.number().min(0).optional(),
    transferencia: vine.number().min(0).optional(),
    postnet: vine.number().min(0).optional(),
    items: vine
      .array(
        vine.object({
          productId: vine.number().positive(),
          quantity: vine.number().min(1),
        })
      )
      .minLength(1),
  })
)

export default class SalesController {
  async index({ request, response }: HttpContext) {
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))

    const query = Sale.query()
      .preload('items')
      .preload('seller', (q) => q.select('id', 'fullName', 'email'))
      .preload('customer', (q) => q.select('id', 'fullName', 'phone'))

    const status = request.input('status')
    if (status === 'completed' || status === 'cancelled') query.where('status', status)

    // Inclusive day bounds in ART, matching how the reservations calendar and
    // stats treat `from`/`to` — a date filter that silently drops the last day
    // is the classic off-by-one nobody notices until month close.
    const from = request.input('from')
    const to = request.input('to')
    if (from) {
      query.where(
        'created_at',
        '>=',
        DateTime.fromISO(String(from), { zone: 'America/Argentina/Buenos_Aires' })
          .startOf('day')
          .toUTC()
          .toSQL()!
      )
    }
    if (to) {
      query.where(
        'created_at',
        '<=',
        DateTime.fromISO(String(to), { zone: 'America/Argentina/Buenos_Aires' })
          .endOf('day')
          .toUTC()
          .toSQL()!
      )
    }

    const sales = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, perPage)
    return response.ok(sales)
  }

  async show({ params, response }: HttpContext) {
    const sale = await Sale.query()
      .where('id', params.id)
      .preload('items')
      .preload('seller', (q) => q.select('id', 'fullName', 'email'))
      .preload('customer', (q) => q.select('id', 'fullName', 'phone'))
      .firstOrFail()
    return response.ok(sale)
  }

  /**
   * Prices come from the DATABASE, never from the request. The register only
   * says what and how many — if the client could send `unitPrice`, anyone with
   * `sales.create` could sell a paddle for one peso without ever touching the
   * price list, which is exactly the split `products.update` exists to enforce.
   *
   * Every product row is locked with forUpdate() before any stock is written,
   * in a stable id order, so two registers ringing up the last unit of the same
   * item serialise instead of both succeeding.
   */
  async store(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const data = await request.validateUsing(saleValidator)

    const split = {
      efectivo: round2(data.efectivo ?? 0),
      transferencia: round2(data.transferencia ?? 0),
      postnet: round2(data.postnet ?? 0),
    }

    // Same product listed twice is merged rather than rejected — a POS grid
    // tapped twice is normal, and two lines would each check stock separately.
    const merged = new Map<number, number>()
    for (const item of data.items) {
      if (!Number.isInteger(item.quantity)) {
        return response.badRequest({ message: 'La cantidad debe ser un número entero' })
      }
      merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity)
    }
    const productIds = [...merged.keys()].sort((a, b) => a - b)

    try {
      const sale = await db.transaction(async (trx) => {
        const products = await Product.query({ client: trx })
          .whereIn('id', productIds)
          .whereNull('deleted_at')
          .forUpdate()
          .orderBy('id', 'asc')

        if (products.length !== productIds.length) {
          throw new SaleValidationError('Alguno de los productos ya no existe')
        }

        const productById = new Map(products.map((p) => [p.id, p]))
        const lines = productIds.map((id) => {
          const product = productById.get(id)!
          if (!product.isActive) {
            throw new SaleValidationError(`"${product.name}" está inactivo y no se puede vender`)
          }
          const quantity = merged.get(id)!
          return {
            product,
            quantity,
            unitPrice: product.price,
            subtotal: lineSubtotal({ unitPrice: product.price, quantity }),
          }
        })

        const total = saleTotal(lines)

        // No split sent at all (all three zero on a non-zero sale) is treated as
        // "all cash" — the overwhelmingly common kiosk case, and it keeps the
        // register from rejecting a valid sale over an unticked radio button.
        if (total > 0 && paymentSum(split) === 0) {
          split.efectivo = total
        }
        if (!paymentMatchesTotal(total, split)) {
          throw new SaleValidationError(
            `El pago (${paymentSum(split)}) no coincide con el total de la venta (${total})`
          )
        }

        const created = new Sale()
        created.useTransaction(trx)
        created.merge({
          userId: auth.user!.id,
          customerId: data.customerId ?? null,
          // Turno de caja en que entró la plata. middleware.cashRegister ya garantizó
          // que hay una sesión abierta. Ver la migración 1784000000005.
          cashSessionId: await currentCashSessionId(ctx),
          total,
          efectivo: split.efectivo,
          transferencia: split.transferencia,
          postnet: split.postnet,
          status: 'completed',
          notes: data.notes ?? null,
        })
        await created.save()

        for (const line of lines) {
          const item = new SaleItem()
          item.useTransaction(trx)
          item.merge({
            saleId: created.id,
            productId: line.product.id,
            productName: line.product.name,
            unitPrice: line.unitPrice,
            unitCost: line.product.cost,
            quantity: line.quantity,
            subtotal: line.subtotal,
          })
          await item.save()

          await applyStockMovement(trx, line.product, {
            type: 'sale',
            quantity: line.quantity,
            performedBy: auth.user!.id,
            saleId: created.id,
          })
        }

        await logCommerce(
          {
            performedBy: auth.user!.id,
            entityType: 'sale',
            entityId: created.id,
            entityLabel: `Venta #${created.id}`,
            action: 'create',
            trx,
          },
          [
            { field: 'total', oldValue: null, newValue: String(total) },
            {
              field: 'items',
              oldValue: null,
              newValue: lines.map((l) => `${l.quantity}× ${l.product.name}`).join(', '),
            },
          ]
        )

        return created
      })

      await sale.load('items')
      await sale.load('seller', (q) => q.select('id', 'fullName', 'email'))
      return response.created(sale)
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return response.badRequest({ message: error.message })
      }
      if (error instanceof InsufficientStockError) {
        return response.badRequest({ message: error.message })
      }
      throw error
    }
  }

  /**
   * Cancels rather than deletes: the row stays, the stock comes back as
   * `return` movements. A voided sale that leaves no trace is how a register
   * loses money quietly.
   */
  async destroy(ctx: HttpContext) {
    const { params, response, auth } = ctx
    const sale = await Sale.query().where('id', params.id).preload('items').firstOrFail()

    if (sale.status === 'cancelled') {
      return response.badRequest({ message: 'La venta ya está anulada' })
    }

    await db.transaction(async (trx) => {
      for (const item of sale.items) {
        if (!item.productId) continue
        const product = await Product.query({ client: trx })
          .where('id', item.productId)
          .forUpdate()
          .first()
        if (!product) continue
        await applyStockMovement(trx, product, {
          type: 'return',
          quantity: item.quantity,
          performedBy: auth.user!.id,
          saleId: sale.id,
          reason: `Anulación de venta #${sale.id}`,
        })
      }

      sale.useTransaction(trx)
      sale.status = 'cancelled'
      sale.cancelledBy = auth.user!.id
      sale.cancelledAt = DateTime.now()
      // La devolución sale del turno ACTUAL, que puede no ser el de la venta.
      sale.cancelledInCashSessionId = await currentCashSessionId(ctx)
      await sale.save()

      await logCommerce(
        {
          performedBy: auth.user!.id,
          entityType: 'sale',
          entityId: sale.id,
          entityLabel: `Venta #${sale.id}`,
          action: 'cancel',
          trx,
        },
        [{ field: 'total', oldValue: String(sale.total), newValue: '0' }]
      )
    })

    return response.ok({ message: 'Venta anulada correctamente' })
  }
}

class SaleValidationError extends Error {}
