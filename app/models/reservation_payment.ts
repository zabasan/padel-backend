import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Reservation from '#models/reservation'

export default class ReservationPayment extends BaseModel {
  @column({ isPrimary: true }) declare id: number
  @column() declare reservationId: number
  @column() declare type: 'deposit' | 'total'
  @column() declare efectivo: number
  @column() declare transferencia: number
  @column() declare postnet: number
  @column() declare total: number
  @column() declare paidBy: number
  @column() declare receipt: string | null
  @column({
    consume: (value) => {
      if (!value) return null
      if (typeof value === 'string') return value.slice(0, 10)
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value).slice(0, 10)
    },
  })
  declare occurrenceDate: string | null
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime

  @belongsTo(() => Reservation) declare reservation: BelongsTo<typeof Reservation>
}
