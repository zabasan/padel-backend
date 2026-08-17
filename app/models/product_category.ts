import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Product from '#models/product'

export default class ProductCategory extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column({ consume: (v) => Boolean(v) })
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  // Explicit foreignKey: Lucid would otherwise derive `productCategoryId` from the model name,
  // and the column is `categoryId`. Without this, any query that touches the relation (the
  // withCount on the categories list) throws E_MISSING_MODEL_ATTRIBUTE.
  @hasMany(() => Product, { foreignKey: 'categoryId' })
  declare products: HasMany<typeof Product>
}
