import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Court from '#models/court'

export default class CourtPriceHistory extends BaseModel {
  static table = 'court_price_history'

  @column({ isPrimary: true }) declare id: number
  @column() declare courtId: number
  @column.dateTime() declare effectiveFrom: DateTime
  @column() declare startHour: number
  @column() declare endHour: number
  @column() declare pricePerHour: number
  @column() declare isPeakHour: boolean
  // Lucid maps price60Min → price_60_min (lodash snakeCase handles digit boundaries)
  @column() declare price60Min: number | null
  @column() declare price90Min: number | null
  @column() declare price120Min: number | null
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime

  @belongsTo(() => Court) declare court: BelongsTo<typeof Court>
}
