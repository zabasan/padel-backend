import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import User from '#models/user'

export default class UserAuditLog extends BaseModel {
  static table = 'user_audit_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare performedBy: number | null

  @column()
  declare targetUserId: number

  @column()
  declare field: string

  @column()
  declare oldValue: string | null

  @column()
  declare newValue: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'performedBy' })
  declare performer: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'targetUserId' })
  declare targetUser: BelongsTo<typeof User>
}
