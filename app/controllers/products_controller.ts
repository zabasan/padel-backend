import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import Product from '#models/product'
import StockMovement from '#models/stock_movement'
import { InsufficientStockError, applyStockMovement } from '#services/commerce'
import { PRODUCT_AUDITED_FIELDS, diffFields, logCommerce } from '#services/commerce_audit'

const productValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(120),
    categoryId: vine.number().positive().optional().nullable(),
    sku: vine.string().trim().maxLength(60).optional().nullable(),
    price: vine.number().min(0),
    cost: vine.number().min(0).optional(),
    minStock: vine.number().min(0).optional(),
    trackStock: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
  })
)

/** Opening stock, accepted only on create — afterwards stock moves through /stock. */
const createValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(120),
    categoryId: vine.number().positive().optional().nullable(),
    sku: vine.string().trim().maxLength(60).optional().nullable(),
    price: vine.number().min(0),
    cost: vine.number().min(0).optional(),
    stock: vine.number().min(0).optional(),
    minStock: vine.number().min(0).optional(),
    trackStock: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
  })
)

const stockValidator = vine.compile(
  vine.object({
    type: vine.enum(['in', 'out', 'adjustment'] as const),
    quantity: vine.number(),
    reason: vine.string().trim().maxLength(300).optional().nullable(),
  })
)

export default class ProductsController {
  /** Paginated list for the products ABM. */
  async index({ request, response }: HttpContext) {
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))

    const query = Product.query().whereNull('deletedAt').preload('category')

    const search = String(request.input('search', '')).trim()
    if (search) {
      query.where((builder) => {
        builder.whereILike('name', `%${search}%`).orWhereILike('sku', `%${search}%`)
      })
    }

    const categoryId = request.input('categoryId')
    if (categoryId) query.where('category_id', Number(categoryId))

    const active = request.input('active')
    if (active === 'true') query.where('is_active', true)
    if (active === 'false') query.where('is_active', false)

    // MySQL can't compare two columns through the query builder's where(), so
    // the low-stock filter goes raw. `track_stock` guards it: an untracked
    // product sits at stock 0 forever and would otherwise always look low.
    if (request.input('lowStock') === 'true') {
      query.where('track_stock', true).whereRaw('stock <= min_stock')
    }

    const products = await query.orderBy('name', 'asc').paginate(page, perPage)
    return response.ok(products)
  }

  /**
   * Flat active catalog for the POS — no pagination, the register needs every
   * sellable item in one shot to render its grid.
   */
  async catalog({ response }: HttpContext) {
    const products = await Product.query()
      .whereNull('deletedAt')
      .where('is_active', true)
      .preload('category')
      .orderBy('name', 'asc')

    return response.ok(products)
  }

  async show({ params, response }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .preload('category')
      .firstOrFail()
    return response.ok(product)
  }

  async store({ request, response, auth }: HttpContext) {
    const data = await request.validateUsing(createValidator)

    if (data.sku) {
      const duplicate = await Product.query().whereNull('deletedAt').where('sku', data.sku).first()
      if (duplicate) {
        return response.conflict({ message: 'Ya existe un producto con ese código' })
      }
    }

    const openingStock = data.stock ?? 0

    const product = await db.transaction(async (trx) => {
      const created = new Product()
      created.useTransaction(trx)
      created.merge({
        name: data.name,
        categoryId: data.categoryId ?? null,
        sku: data.sku ?? null,
        price: data.price,
        cost: data.cost ?? 0,
        stock: 0,
        minStock: data.minStock ?? 0,
        trackStock: data.trackStock ?? true,
        isActive: data.isActive ?? true,
      })
      await created.save()

      // Opening stock is a real movement, not a column write — otherwise the
      // ledger starts out already disagreeing with the running total.
      if (openingStock > 0 && created.trackStock) {
        await applyStockMovement(trx, created, {
          type: 'in',
          quantity: openingStock,
          performedBy: auth.user!.id,
          reason: 'Stock inicial',
        })
      }

      await logCommerce({
        performedBy: auth.user!.id,
        entityType: 'product',
        entityId: created.id,
        entityLabel: created.name,
        action: 'create',
        trx,
      })

      return created
    })

    await product.load('category')
    return response.created(product)
  }

  /**
   * Stock is NOT editable here — it moves only through `adjustStock`, so every
   * change lands in the ledger with a performer and a reason.
   */
  async update({ params, request, response, auth }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()
    const data = await request.validateUsing(productValidator)

    if (data.sku) {
      const duplicate = await Product.query()
        .whereNull('deletedAt')
        .whereNot('id', product.id)
        .where('sku', data.sku)
        .first()
      if (duplicate) {
        return response.conflict({ message: 'Ya existe un producto con ese código' })
      }
    }

    // Snapshot BEFORE the merge — after it, `product` already holds the new values and the
    // diff would come out empty.
    const before = product.serialize()

    product.merge({
      name: data.name,
      categoryId: data.categoryId ?? null,
      sku: data.sku ?? null,
      price: data.price,
      cost: data.cost ?? product.cost,
      minStock: data.minStock ?? product.minStock,
      trackStock: data.trackStock ?? product.trackStock,
      isActive: data.isActive ?? product.isActive,
    })
    await product.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'product',
        entityId: product.id,
        entityLabel: product.name,
        action: 'update',
      },
      diffFields(before, product.serialize(), PRODUCT_AUDITED_FIELDS)
    )

    await product.load('category')

    return response.ok(product)
  }

  async toggleActive({ params, response, auth }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()
    const wasActive = product.isActive
    product.isActive = !product.isActive
    await product.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'product',
        entityId: product.id,
        entityLabel: product.name,
        action: 'update',
      },
      [{ field: 'isActive', oldValue: String(wasActive), newValue: String(product.isActive) }]
    )

    return response.ok(product)
  }

  /** Soft delete — sale_items keep their FK, so old tickets stay readable. */
  async destroy({ params, response, auth }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()
    product.deletedAt = DateTime.now()
    product.isActive = false
    await product.save()

    await logCommerce({
      performedBy: auth.user!.id,
      entityType: 'product',
      entityId: product.id,
      entityLabel: product.name,
      action: 'delete',
    })

    return response.ok({ message: 'Producto eliminado correctamente' })
  }

  /**
   * `adjustment` takes an ABSOLUTE target (the number on the shelf after a
   * physical count), not a delta — that is what whoever is counting actually
   * has in hand. `in`/`out` take a quantity to add or remove.
   */
  async adjustStock({ params, request, response, auth }: HttpContext) {
    const product = await Product.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()
    const data = await request.validateUsing(stockValidator)

    if (!product.trackStock) {
      return response.badRequest({ message: 'Este producto no lleva control de stock' })
    }
    if (!Number.isInteger(data.quantity)) {
      return response.badRequest({ message: 'La cantidad debe ser un número entero' })
    }
    if (data.type !== 'adjustment' && data.quantity <= 0) {
      return response.badRequest({ message: 'La cantidad debe ser mayor a cero' })
    }
    if (data.type === 'adjustment' && data.quantity < 0) {
      return response.badRequest({ message: 'El stock contado no puede ser negativo' })
    }

    const quantity = data.type === 'adjustment' ? data.quantity - product.stock : data.quantity

    try {
      await db.transaction(async (trx) => {
        const locked = await Product.query({ client: trx })
          .where('id', product.id)
          .forUpdate()
          .firstOrFail()
        const movement = await applyStockMovement(trx, locked, {
          type: data.type,
          quantity,
          performedBy: auth.user!.id,
          reason: data.reason ?? null,
        })

        // stock_movements is the detailed ledger; this mirrors the fact into the commerce
        // audit so "who touched the shop today" is answerable from one screen.
        await logCommerce(
          {
            performedBy: auth.user!.id,
            entityType: 'product',
            entityId: locked.id,
            entityLabel: locked.name,
            action: 'stock',
            trx,
          },
          [
            {
              field: data.type,
              oldValue: String(movement.stockBefore),
              newValue: String(movement.stockAfter),
            },
          ]
        )
      })
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return response.badRequest({ message: error.message })
      }
      throw error
    }

    await product.refresh()
    await product.load('category')
    return response.ok(product)
  }

  async movements({ params, request, response }: HttpContext) {
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))

    const movements = await StockMovement.query()
      .where('product_id', params.id)
      .preload('performer', (query) => query.select('id', 'fullName', 'email'))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, perPage)

    return response.ok(movements)
  }
}
