import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Reservation from '#models/reservation'

export default class ReservationHiddenDate extends BaseModel {
  static table = 'reservation_hidden_dates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reservationId: number

  @column({
    consume: (value) => {
      if (!value) return null
      if (typeof value === 'string') return value.slice(0, 10)
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value).slice(0, 10)
    },
  })
  declare hiddenDate: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Reservation)
  declare reservation: BelongsTo<typeof Reservation>
}
