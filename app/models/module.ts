import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Permission module catalog. Rows are added ONLY by migrations, never at
 * runtime — see database/seed_data/permission_matrix.ts.
 */
export default class Module extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare visibleName: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
