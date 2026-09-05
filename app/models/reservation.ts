import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Court from '#models/court'
import User from '#models/user'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import ReservationPayment from '#models/reservation_payment'

export default class Reservation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare courtId: number

  @column()
  declare userId: number

  @column()
  declare contactPhone: string | null

  @column()
  declare customerId: number | null

  @column.dateTime()
  declare startTime: DateTime

  @column.dateTime()
  declare endTime: DateTime

  @column()
  declare status: 'pending' | 'confirmed' | 'cancelled'

  @column()
  declare notes: string | null

  @column()
  declare totalPrice: number

  @column({
    consume: (value) => Boolean(value),
  })
  declare isRecurring: boolean

  @column({
    consume: (value) => {
      if (!value) return null
      if (typeof value === 'string') return value.slice(0, 10)
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value).slice(0, 10)
    },
  })
  declare hiddenUntil: string | null

  @column({
    consume: (value) => {
      if (!value) return null
      if (typeof value === 'string') return value.slice(0, 10)
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value).slice(0, 10)
    },
  })
  declare hiddenFrom: string | null

  @column()
  declare depositPercentage: number | null

  @column()
  declare depositFixedAmount: number | null

  @column({ consume: (v) => Boolean(v) })
  declare depositPaid: boolean

  @column()
  declare depositReceipt: string | null

  @column({ consume: (v) => Boolean(v) })
  declare totalPaid: boolean

  @column()
  declare totalReceipt: string | null

  @column.dateTime()
  declare confirmedAt: DateTime | null

  @column()
  declare confirmedBy: number | null

  @column.dateTime()
  declare cancelledAt: DateTime | null

  @column()
  declare cancelledBy: number | null

  @column.dateTime()
  declare depositPaidAt: DateTime | null

  @column()
  declare depositPaidBy: number | null

  @column.dateTime()
  declare totalPaidAt: DateTime | null

  @column()
  declare totalPaidBy: number | null

  @column()
  declare discountPercentage: number

  @column()
  declare consecutiveGames: number

  // Participación de ESTA serie en la promo de partidos consecutivos. Apagarla congela
  // `consecutiveGames` en 0: no suma con cada pago ni habilita el partido gratis.
  // Inerte en reservas no recurrentes.
  // `consume` porque MySQL devuelve tinyint 0/1 y el front necesita distinguir el `false`
  // explícito de "el campo no vino" — un 0 crudo se serializa como número, no como booleano.
  @column({ consume: (v) => Boolean(v) })
  declare promoEnabled: boolean

  @column()
  declare consecutiveGamesSnapshot: number | null

  @column.dateTime()
  declare lastIncrementedAt: DateTime | null

  @column()
  declare totalPaidCount: number

  @column()
  declare customPrice: number | null

  @column()
  declare classType: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Court)
  declare court: BelongsTo<typeof Court>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'customerId' })
  declare customer: BelongsTo<typeof User>

  @hasMany(() => ReservationHiddenDate)
  declare hiddenDates: HasMany<typeof ReservationHiddenDate>

  // Solo los pagos VIGENTES. Un pago revertido conserva su fila (ver la migración
  // 1784000000001), así que el filtro va acá, en la relación, y no en cada preload:
  // hay siete `preload('payments')` y dos `load('payments')` en el controller, y el
  // estado de pago por ocurrencia y el carry balance de las fijas se calculan sobre
  // esta colección. Un preload nuevo hereda el filtro sin que nadie se acuerde.
  // Para leer los revertidos (el cierre de caja lo hace) se consulta
  // ReservationPayment directo.
  @hasMany(() => ReservationPayment, {
    onQuery: (query) => query.whereNull('reverted_at'),
  })
  declare payments: HasMany<typeof ReservationPayment>
}
