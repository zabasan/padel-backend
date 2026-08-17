import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Product from '#models/product'
import User from '#models/user'

export type StockMovementType = 'in' | 'out' | 'adjustment' | 'sale' | 'return'

export default class StockMovement extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare productId: number

  @column()
  declare type: StockMovementType

  /** Signed delta: +5 on a restock, -2 on a sale. */
  @column({ consume: (v) => Number(v) })
  declare quantity: number

  @column({ consume: (v) => Number(v) })
  declare stockBefore: number

  @column({ consume: (v) => Number(v) })
  declare stockAfter: number

  @column()
  declare reason: string | null

  @column()
  declare saleId: number | null

  @column()
  declare performedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => User, { foreignKey: 'performedBy' })
  declare performer: BelongsTo<typeof User>
}
