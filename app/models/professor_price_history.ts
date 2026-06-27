import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class ProfessorPriceHistory extends BaseModel {
  static table = 'professor_price_history'

  @column({ isPrimary: true }) declare id: number
  @column.dateTime() declare effectiveFrom: DateTime
  @column() declare priceIndividual: number
  @column() declare priceGroup: number
  @column() declare priceIndividualWeekend: number
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime
}
