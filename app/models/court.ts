import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Reservation from '#models/reservation'
import CourtPriceRange from '#models/court_price_range'

export default class Court extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare type: 'padel' | 'football'

  @column()
  declare description: string | null

  @column()
  declare pricePerHour: number

  @column()
  declare isActive: boolean

  /**
   * La seña por defecto de ESTA cancha, en porcentaje. `null` significa "no define nada,
   * usá el global de Ajustes (`defaultDepositPercentage`)"; un `0` guardado es distinto —
   * es "esta cancha no lleva seña" y pisa un global mayor a cero.
   */
  @column()
  declare depositPercentage: number | null

  @column()
  declare parentCourtId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => Reservation)
  declare reservations: HasMany<typeof Reservation>

  @hasMany(() => CourtPriceRange)
  declare priceRanges: HasMany<typeof CourtPriceRange>

  @belongsTo(() => Court, { foreignKey: 'parentCourtId' })
  declare parentCourt: BelongsTo<typeof Court>

  @hasMany(() => Court, { foreignKey: 'parentCourtId' })
  declare subCourts: HasMany<typeof Court>
}
