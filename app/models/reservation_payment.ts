import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Reservation from '#models/reservation'
import User from '#models/user'

export default class ReservationPayment extends BaseModel {
  @column({ isPrimary: true }) declare id: number
  @column() declare reservationId: number
  // `debt` es el cobro del saldo arrastrado de una fija, no el pago de una ocurrencia.
  // La distinción importa: todo lo que pregunta "¿esta semana está paga?" filtra
  // `type='total'`. Ver la migración 1785000000003.
  @column() declare type: 'deposit' | 'total' | 'debt'
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
  @column() declare expectedAmount: number | null
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime

  // Anulación, no borrado. Un pago revertido conserva su fila para que el cierre de caja
  // pueda imputar la salida de plata al turno en que se revirtió — que puede no ser el
  // turno en que se cobró. Ver la migración 1784000000001.
  //
  // `reverted_at IS NULL` es la condición de "pago vigente". La relación
  // Reservation.payments la aplica en su onQuery; toda consulta directa la agrega a mano.
  @column.dateTime() declare revertedAt: DateTime | null
  @column() declare revertedBy: number | null

  // A qué sesión de caja pertenece el cobro, y a cuál la devolución. Son DOS columnas
  // porque son dos turnos distintos: el cobro entra donde se cobró, la devolución sale
  // de donde se devolvió. Ver la migración 1784000000005 para por qué esto es un dato
  // explícito y no una ventana de tiempo.
  @column() declare cashSessionId: number | null
  @column() declare revertedInCashSessionId: number | null

  @belongsTo(() => Reservation) declare reservation: BelongsTo<typeof Reservation>

  // Quién cobró. La columna existía desde el principio pero sin relación, así que el
  // nombre del cajero había que buscarlo aparte.
  @belongsTo(() => User, { foreignKey: 'paidBy' }) declare payer: BelongsTo<typeof User>
  @belongsTo(() => User, { foreignKey: 'revertedBy' }) declare reverter: BelongsTo<typeof User>
}
