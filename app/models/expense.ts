import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import ExpenseCategory from '#models/expense_category'
import User from '#models/user'

/**
 * Un gasto de las instalaciones: pintura, papel higiénico, la factura de la luz, el
 * servicio de limpieza.
 *
 * Los cuatro decimales llevan `consume: Number` porque mysql2 devuelve DECIMAL como
 * string — sin esto, `amount + efectivo` concatena en vez de sumar. Misma decisión que
 * en `sale.ts`.
 */
export default class Expense extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  /** Nullable: la categoría puede retirarse y el gasto histórico sobrevive sin ella. */
  @column()
  declare categoryId: number | null

  @column()
  declare description: string

  @column()
  declare supplier: string | null

  @column({ consume: (v) => Number(v) })
  declare amount: number

  @column({ consume: (v) => Number(v) })
  declare efectivo: number

  @column({ consume: (v) => Number(v) })
  declare transferencia: number

  @column({ consume: (v) => Number(v) })
  declare postnet: number

  /**
   * El día (ART) en que la plata salió, NO cuándo se cargó la fila. La factura de ayer
   * se carga hoy y pertenece a ayer; las estadísticas filtran por acá.
   * `@column.date` serializa como 'yyyy-MM-dd', que es lo que consume el front.
   */
  @column.date()
  declare expenseDate: DateTime

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

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // Turno de caja en que salió la plata, y en que volvió si se anuló.
  // Ver la migración 1784000000005.
  @column() declare cashSessionId: number | null
  @column() declare cancelledInCashSessionId: number | null

  @belongsTo(() => ExpenseCategory, { foreignKey: 'categoryId' })
  declare category: BelongsTo<typeof ExpenseCategory>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'cancelledBy' })
  declare canceller: BelongsTo<typeof User>
}
