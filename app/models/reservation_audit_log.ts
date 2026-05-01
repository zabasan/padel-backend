import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import User from '#models/user'
import Reservation from '#models/reservation'

export default class ReservationAuditLog extends BaseModel {
  @column({ isPrimary: true }) declare id: number
  @column() declare performedBy: number | null
  @column() declare reservationId: number
  @column() declare field: string
  @column() declare oldValue: string | null
  @column() declare newValue: string | null
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'performedBy' }) declare performer: BelongsTo<typeof User>
  @belongsTo(() => Reservation) declare reservation: BelongsTo<typeof Reservation>
}
