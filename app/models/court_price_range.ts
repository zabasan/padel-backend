import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Court from '#models/court'

export default class CourtPriceRange extends BaseModel {
  @column({ isPrimary: true }) declare id: number
  @column() declare courtId: number
  @column() declare startHour: number  // 0-23
  @column() declare endHour: number    // 1-24
  @column() declare pricePerHour: number
  @column() declare isPeakHour: boolean
  @column() declare price60Min: number | null
  @column() declare price90Min: number | null
  @column() declare price120Min: number | null
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updatedAt: DateTime | null
  @belongsTo(() => Court) declare court: BelongsTo<typeof Court>
}
