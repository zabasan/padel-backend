import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import Expense from '#models/expense'
import ExpenseCategory from '#models/expense_category'
import { diffFields, logCommerce } from '#services/commerce_audit'

const categoryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(80),
    isActive: vine.boolean().optional(),
  })
)

/**
 * ABM de categorías de gasto. Calco deliberado de product_categories_controller: mismo
 * chequeo de duplicado case-insensitive, mismo soft delete, misma auditoría. Dos
 * pantallas que hacen lo mismo deberían leerse igual.
 */
export default class ExpenseCategoriesController {
  async index({ response }: HttpContext) {
    const categories = await ExpenseCategory.query()
      .whereNull('deletedAt')
      .withCount('expenses', (query) => query.where('status', 'completed'))
      .orderBy('name', 'asc')

    return response.ok(
      categories.map((category) => ({
        ...category.serialize(),
        expensesCount: Number(category.$extras.expenses_count ?? 0),
      }))
    )
  }

  async store({ request, response, auth }: HttpContext) {
    const data = await request.validateUsing(categoryValidator)

    const duplicate = await ExpenseCategory.query()
      .whereNull('deletedAt')
      .whereRaw('LOWER(name) = ?', [data.name.toLowerCase()])
      .first()
    if (duplicate) {
      return response.conflict({ message: 'Ya existe una categoría de gasto con ese nombre' })
    }

    const category = await ExpenseCategory.create({
      name: data.name,
      isActive: data.isActive ?? true,
    })

    await logCommerce({
      performedBy: auth.user!.id,
      entityType: 'expense_category',
      entityId: category.id,
      entityLabel: category.name,
      action: 'create',
    })

    return response.created(category)
  }

  async update({ params, request, response, auth }: HttpContext) {
    const category = await ExpenseCategory.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()
    const data = await request.validateUsing(categoryValidator)

    const duplicate = await ExpenseCategory.query()
      .whereNull('deletedAt')
      .whereNot('id', category.id)
      .whereRaw('LOWER(name) = ?', [data.name.toLowerCase()])
      .first()
    if (duplicate) {
      return response.conflict({ message: 'Ya existe una categoría de gasto con ese nombre' })
    }

    const before = category.serialize()
    category.merge({ name: data.name, isActive: data.isActive ?? category.isActive })
    await category.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'expense_category',
        entityId: category.id,
        entityLabel: category.name,
        action: 'update',
      },
      diffFields(before, category.serialize(), ['name', 'isActive'])
    )

    return response.ok(category)
  }

  /**
   * Soft delete. Los gastos se desasocian primero (category_id -> null) en vez de quedar
   * apuntando a una fila retirada: las estadísticas agrupan por categoría, y un gasto
   * archivado bajo una categoría que nadie ve es plata que no aparece en ningún grupo.
   */
  async destroy({ params, response, auth }: HttpContext) {
    const category = await ExpenseCategory.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()

    const detached = await Expense.query()
      .where('category_id', category.id)
      .update({ category_id: null })

    category.deletedAt = DateTime.now()
    await category.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'expense_category',
        entityId: category.id,
        entityLabel: category.name,
        action: 'delete',
      },
      [{ field: 'expensesDetached', oldValue: null, newValue: String(detached) }]
    )

    return response.ok({ message: 'Categoría eliminada correctamente' })
  }
}
