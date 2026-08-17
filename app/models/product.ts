import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import ProductCategory from '#models/product_category'
import StockMovement from '#models/stock_movement'

/**
 * Money columns carry `consume: Number` because mysql2 hands DECIMAL back as a
 * string. The older models (reservation, reservation_payment) leave that to the
 * frontend, which is why `Number(r.totalPrice)` is sprinkled all over the React
 * side. New tables do not inherit that.
 */
export default class Product extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare categoryId: number | null

  @column()
  declare name: string

  @column()
  declare sku: string | null

  @column({ consume: (v) => Number(v) })
  declare price: number

  @column({ consume: (v) => Number(v) })
  declare cost: number

  @column({ consume: (v) => Number(v) })
  declare stock: number

  @column({ consume: (v) => Number(v) })
  declare minStock: number

  @column({ consume: (v) => Boolean(v) })
  declare trackStock: boolean

  @column({ consume: (v) => Boolean(v) })
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => ProductCategory, { foreignKey: 'categoryId' })
  declare category: BelongsTo<typeof ProductCategory>

  @hasMany(() => StockMovement)
  declare movements: HasMany<typeof StockMovement>

  /** True when the product is inventoried and has fallen to or below its floor. */
  get isLowStock(): boolean {
    return this.trackStock && this.stock <= this.minStock
  }

  serializeExtras() {
    return { isLowStock: this.isLowStock }
  }
}
