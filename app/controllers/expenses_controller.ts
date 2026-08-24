import type { HttpContext } from '@adonisjs/core/http'
import { currentCashSessionId } from '#services/cash_register'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import Expense from '#models/expense'
import ExpenseCategory from '#models/expense_category'
import { paymentMatchesTotal, paymentSum, round2 } from '#services/commerce'
import { EXPENSE_AUDITED_FIELDS, normalizeSplit } from '#services/expenses'
import { diffFields, logCommerce } from '#services/commerce_audit'

const ART_TZ = 'America/Argentina/Buenos_Aires'

const expenseValidator = vine.compile(
  vine.object({
    categoryId: vine.number().positive().optional().nullable(),
    description: vine.string().trim().minLength(2).maxLength(200),
    supplier: vine.string().trim().maxLength(120).optional().nullable(),
    amount: vine.number().min(0),
    efectivo: vine.number().min(0).optional(),
    transferencia: vine.number().min(0).optional(),
    postnet: vine.number().min(0).optional(),
    // 'yyyy-MM-dd' — el día ART en que salió la plata, no cuándo se carga la fila.
    expenseDate: vine
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: vine.string().trim().maxLength(500).optional().nullable(),
  })
)

class ExpenseValidationError extends Error {}

export default class ExpensesController {
  async index({ request, response }: HttpContext) {
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))

    const query = Expense.query()
      .preload('category')
      .preload('creator', (q) => q.select('id', 'fullName', 'email'))
      .preload('canceller', (q) => q.select('id', 'fullName'))

    const status = request.input('status')
    if (status === 'completed' || status === 'cancelled') query.where('status', status)

    const categoryId = Number(request.input('categoryId')) || 0
    if (categoryId) query.where('category_id', categoryId)

    // Bordes inclusivos sobre expense_date, que ya es un DATE en ART — sin conversión de
    // zona, a diferencia de sales.created_at. Un filtro de fechas que se come el último
    // día es el off-by-one clásico que nadie nota hasta el cierre de mes.
    const from = request.input('from')
    const to = request.input('to')
    if (from) query.where('expense_date', '>=', String(from))
    if (to) query.where('expense_date', '<=', String(to))

    const expenses = await query
      .orderBy('expense_date', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, perPage)

    return response.ok(expenses)
  }

  async show({ params, response }: HttpContext) {
    const expense = await Expense.query()
      .where('id', params.id)
      .preload('category')
      .preload('creator', (q) => q.select('id', 'fullName', 'email'))
      .preload('canceller', (q) => q.select('id', 'fullName'))
      .firstOrFail()
    return response.ok(expense)
  }

  async store(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const data = await request.validateUsing(expenseValidator)

    try {
      const amount = round2(data.amount)
      const split = await this.resolveSplit(amount, data)
      const categoryId = await this.resolveCategoryId(data.categoryId)

      const expense = await Expense.create({
        categoryId,
        // Turno de caja en que SALIÓ la plata. Ojo: es el turno del momento de la carga,
        // no el de `expenseDate` — la factura de la luz de ayer cargada hoy sale del
        // cajón de hoy. Ver la migración 1784000000005.
        cashSessionId: await currentCashSessionId(ctx),
        description: data.description,
        supplier: data.supplier ?? null,
        amount,
        efectivo: split.efectivo,
        transferencia: split.transferencia,
        postnet: split.postnet,
        expenseDate: DateTime.fromISO(data.expenseDate, { zone: ART_TZ }),
        notes: data.notes ?? null,
        status: 'completed',
        createdBy: auth.user!.id,
      })

      await logCommerce(
        {
          performedBy: auth.user!.id,
          entityType: 'expense',
          entityId: expense.id,
          entityLabel: expense.description,
          action: 'create',
        },
        [
          { field: 'amount', oldValue: null, newValue: String(amount) },
          { field: 'expenseDate', oldValue: null, newValue: data.expenseDate },
        ]
      )

      await expense.load('category')
      await expense.load('creator', (q) => q.select('id', 'fullName', 'email'))
      return response.created(expense)
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return response.badRequest({ message: error.message })
      }
      throw error
    }
  }

  async update({ params, request, response, auth }: HttpContext) {
    const expense = await Expense.query().where('id', params.id).firstOrFail()

    // Un gasto anulado es un hecho cerrado. Editarlo dejaría la fila diciendo una cosa y
    // la anulación otra, y la auditoría no podría reconstruir cuál de las dos pasó.
    if (expense.status === 'cancelled') {
      return response.badRequest({
        message: 'El gasto está anulado y no se puede editar. Cargá uno nuevo.',
      })
    }

    const data = await request.validateUsing(expenseValidator)

    try {
      const amount = round2(data.amount)
      const split = await this.resolveSplit(amount, data)
      const categoryId = await this.resolveCategoryId(data.categoryId)

      const before = expense.serialize()
      expense.merge({
        categoryId,
        description: data.description,
        supplier: data.supplier ?? null,
        amount,
        efectivo: split.efectivo,
        transferencia: split.transferencia,
        postnet: split.postnet,
        expenseDate: DateTime.fromISO(data.expenseDate, { zone: ART_TZ }),
        notes: data.notes ?? null,
      })
      await expense.save()

      await logCommerce(
        {
          performedBy: auth.user!.id,
          entityType: 'expense',
          entityId: expense.id,
          entityLabel: expense.description,
          action: 'update',
        },
        diffFields(before, expense.serialize(), EXPENSE_AUDITED_FIELDS)
      )

      await expense.load('category')
      await expense.load('creator', (q) => q.select('id', 'fullName', 'email'))
      return response.ok(expense)
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return response.badRequest({ message: error.message })
      }
      throw error
    }
  }

  /**
   * Anula, no borra: la fila queda con `status = 'cancelled'` y quién/cuándo. Un gasto que
   * desaparece sin rastro es exactamente cómo una caja se descuadra en silencio — misma
   * regla que una venta anulada.
   */
  async destroy(ctx: HttpContext) {
    const { params, response, auth } = ctx
    const expense = await Expense.query().where('id', params.id).firstOrFail()

    if (expense.status === 'cancelled') {
      return response.badRequest({ message: 'El gasto ya está anulado' })
    }

    expense.status = 'cancelled'
    expense.cancelledBy = auth.user!.id
    expense.cancelledAt = DateTime.now()
    // La plata vuelve al cajón en el turno ACTUAL, no en el de la carga original.
    expense.cancelledInCashSessionId = await currentCashSessionId(ctx)
    await expense.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'expense',
        entityId: expense.id,
        entityLabel: expense.description,
        action: 'cancel',
      },
      [{ field: 'amount', oldValue: String(expense.amount), newValue: '0' }]
    )

    return response.ok({ message: 'Gasto anulado correctamente' })
  }

  /**
   * Si el monto es > 0 y las tres formas vienen en cero, se asume TODO EFECTIVO: es el
   * caso abrumadoramente común (se pagó del cajón) y evita rechazar un gasto válido por
   * un campo sin tocar. Misma decisión que sales_controller.store.
   */
  private async resolveSplit(
    amount: number,
    data: { efectivo?: number; transferencia?: number; postnet?: number }
  ) {
    const split = normalizeSplit(data)

    if (amount > 0 && paymentSum(split) === 0) {
      split.efectivo = amount
    }
    if (!paymentMatchesTotal(amount, split)) {
      throw new ExpenseValidationError(
        `El desglose de pago (${paymentSum(split)}) no coincide con el monto del gasto (${amount})`
      )
    }

    return split
  }

  /** Una categoría retirada no se puede asignar — si no, el gasto nace invisible. */
  private async resolveCategoryId(categoryId?: number | null): Promise<number | null> {
    if (categoryId === null || categoryId === undefined) return null

    const category = await ExpenseCategory.query()
      .where('id', categoryId)
      .whereNull('deletedAt')
      .first()
    if (!category) {
      throw new ExpenseValidationError('La categoría seleccionada no existe')
    }
    return category.id
  }
}
