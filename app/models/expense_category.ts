import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Expense from '#models/expense'

export default class ExpenseCategory extends BaseModel {
  static table = 'expense_categories'

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

  // foreignKey explícito por la misma razón que en ProductCategory: Lucid derivaría
  // `expenseCategoryId` del nombre del modelo y la columna es `categoryId`. Sin esto, el
  // withCount del listado de categorías tira E_MISSING_MODEL_ATTRIBUTE.
  @hasMany(() => Expense, { foreignKey: 'categoryId' })
  declare expenses: HasMany<typeof Expense>
}
