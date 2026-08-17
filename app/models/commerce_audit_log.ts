import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import User from '#models/user'

export type CommerceEntityType = 'product' | 'category' | 'sale'
export type CommerceAuditAction = 'create' | 'update' | 'delete' | 'cancel' | 'stock'

export default class CommerceAuditLog extends BaseModel {
  static table = 'commerce_audit_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare performedBy: number | null

  @column()
  declare entityType: CommerceEntityType

  @column()
  declare entityId: number

  /** Snapshot of the entity name — the row outlives what it describes. */
  @column()
  declare entityLabel: string

  @column()
  declare action: CommerceAuditAction

  @column()
  declare field: string | null

  @column()
  declare oldValue: string | null

  @column()
  declare newValue: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'performedBy' })
  declare performer: BelongsTo<typeof User>
}
