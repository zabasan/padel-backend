import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import CashSession from '#models/cash_session'
import User from '#models/user'

/**
 * Un fajo: efectivo retirado del cajón durante un turno.
 *
 * `consume: Number` en `amount` porque mysql2 devuelve DECIMAL como string — sin esto,
 * sumar dos fajos concatena en lugar de sumar. Mismo patrón que expense.ts y sale.ts.
 */
export default class CashBundle extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  /** NOT NULL: un fajo no existe fuera de un turno. Ver la migración 1785000000001. */
  @column()
  declare cashSessionId: number

  @column({ consume: (v) => Number(v ?? 0) })
  declare amount: number

  @column()
  declare notes: string | null

  @column()
  declare status: 'completed' | 'cancelled'

  @column()
  declare createdBy: number

  @column()
  declare cancelledBy: number | null

  @column.dateTime()
  declare cancelledAt: DateTime | null

  /** El turno al que vuelve el efectivo, que puede no ser aquel del que salió. */
  @column()
  declare cancelledInCashSessionId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => CashSession, { foreignKey: 'cashSessionId' })
  declare session: BelongsTo<typeof CashSession>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'cancelledBy' })
  declare canceller: BelongsTo<typeof User>
}
