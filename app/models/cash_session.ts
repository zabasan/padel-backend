import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import User from '#models/user'

/**
 * `consume: Number` en todos los decimales porque mysql2 devuelve DECIMAL como string.
 * Sin esto, `session.inEfectivo + session.inPostnet` concatena en lugar de sumar.
 * Mismo patrón que app/models/sale.ts.
 */
const money = { consume: (value: unknown) => Number(value ?? 0) }

export default class CashSession extends BaseModel {
  @column({ isPrimary: true }) declare id: number

  // Snapshot del turno configurado al momento de abrir. Si mañana cambian los turnos en
  // settings, los cierres viejos siguen contando la verdad de cuando pasaron.
  @column() declare shiftName: string
  @column() declare shiftStartMinute: number
  @column() declare shiftEndMinute: number

  @column({
    consume: (value) => {
      if (!value) return null
      if (typeof value === 'string') return value.slice(0, 10)
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value).slice(0, 10)
    },
  })
  declare businessDate: string

  @column.dateTime() declare openedAt: DateTime
  @column() declare openedBy: number
  @column.dateTime() declare expectedCloseAt: DateTime

  @column.dateTime() declare closedAt: DateTime | null
  @column() declare closedBy: number | null

  @column(money) declare openingEfectivo: number

  @column(money) declare inEfectivo: number
  @column(money) declare inTransferencia: number
  @column(money) declare inPostnet: number
  @column(money) declare outEfectivo: number
  @column(money) declare outTransferencia: number
  @column(money) declare outPostnet: number
  @column() declare movementsCount: number

  // Fajos retirados del cajón en el turno, congelados al cerrar. Va aparte de out_*
  // porque un fajo es un traslado, no una salida de plata. Ver la migración 1785000000002.
  @column(money) declare bundlesEfectivo: number

  @column({ consume: (value) => (value === null || value === undefined ? null : Number(value)) })
  declare countedEfectivo: number | null
  @column() declare notes: string | null

  // 1 mientras está abierta, NULL al cerrar. El índice UNIQUE sobre esta columna es lo
  // que hace imposible tener dos sesiones abiertas — ver la migración 1784000000003.
  @column() declare openMarker: number | null

  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'openedBy' }) declare opener: BelongsTo<typeof User>
  @belongsTo(() => User, { foreignKey: 'closedBy' }) declare closer: BelongsTo<typeof User>

  get isOpen(): boolean {
    return this.closedAt === null
  }
}
