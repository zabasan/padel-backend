import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import Product from '#models/product'
import ProductCategory from '#models/product_category'
import { diffFields, logCommerce } from '#services/commerce_audit'

const categoryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(80),
    isActive: vine.boolean().optional(),
  })
)

export default class ProductCategoriesController {
  async index({ response }: HttpContext) {
    const categories = await ProductCategory.query()
      .whereNull('deletedAt')
      .withCount('products', (query) => query.whereNull('deleted_at'))
      .orderBy('name', 'asc')

    return response.ok(
      categories.map((category) => ({
        ...category.serialize(),
        productsCount: Number(category.$extras.products_count ?? 0),
      }))
    )
  }

  async store({ request, response, auth }: HttpContext) {
    const data = await request.validateUsing(categoryValidator)

    const duplicate = await ProductCategory.query()
      .whereNull('deletedAt')
      .whereRaw('LOWER(name) = ?', [data.name.toLowerCase()])
      .first()
    if (duplicate) {
      return response.conflict({ message: 'Ya existe una categoría con ese nombre' })
    }

    const category = await ProductCategory.create({
      name: data.name,
      isActive: data.isActive ?? true,
    })

    await logCommerce({
      performedBy: auth.user!.id,
      entityType: 'category',
      entityId: category.id,
      entityLabel: category.name,
      action: 'create',
    })

    return response.created(category)
  }

  async update({ params, request, response, auth }: HttpContext) {
    const category = await ProductCategory.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()
    const data = await request.validateUsing(categoryValidator)

    const duplicate = await ProductCategory.query()
      .whereNull('deletedAt')
      .whereNot('id', category.id)
      .whereRaw('LOWER(name) = ?', [data.name.toLowerCase()])
      .first()
    if (duplicate) {
      return response.conflict({ message: 'Ya existe una categoría con ese nombre' })
    }

    const before = category.serialize()
    category.merge({ name: data.name, isActive: data.isActive ?? category.isActive })
    await category.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'category',
        entityId: category.id,
        entityLabel: category.name,
        action: 'update',
      },
      diffFields(before, category.serialize(), ['name', 'isActive'])
    )

    return response.ok(category)
  }

  /**
   * Soft delete. Products are detached first (category_id -> null) rather than
   * left pointing at a retired row: the products screen groups by category, and
   * a product filed under a category nobody can see is a product nobody finds.
   */
  async destroy({ params, response, auth }: HttpContext) {
    const category = await ProductCategory.query()
      .where('id', params.id)
      .whereNull('deletedAt')
      .firstOrFail()

    const detached = await Product.query()
      .where('category_id', category.id)
      .update({ category_id: null })

    category.deletedAt = DateTime.now()
    await category.save()

    await logCommerce(
      {
        performedBy: auth.user!.id,
        entityType: 'category',
        entityId: category.id,
        entityLabel: category.name,
        action: 'delete',
      },
      // How many products lost their category matters: it is the collateral damage of the
      // delete, and it is not recoverable from the products themselves afterwards.
      [{ field: 'detachedProducts', oldValue: null, newValue: String(detached) }]
    )

    return response.ok({ message: 'Categoría eliminada correctamente' })
  }
}
