import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import SaleItem from '#models/sale_item'
import User from '#models/user'

export default class Sale extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  /** Who rang it up. */
  @column()
  declare userId: number

  /** The buyer, when they happen to be a known user. Null for a walk-in. */
  @column()
  declare customerId: number | null

  @column({ consume: (v) => Number(v) })
  declare total: number

  @column({ consume: (v) => Number(v) })
  declare efectivo: number

  @column({ consume: (v) => Number(v) })
  declare transferencia: number

  @column({ consume: (v) => Number(v) })
  declare postnet: number

  @column()
  declare status: 'completed' | 'cancelled'

  @column()
  declare notes: string | null

  @column()
  declare cancelledBy: number | null

  @column.dateTime()
  declare cancelledAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => SaleItem)
  declare items: HasMany<typeof SaleItem>

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare seller: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'customerId' })
  declare customer: BelongsTo<typeof User>
}
