import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Court from '#models/court'
import User from '#models/user'

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

  @column()
  declare depositPercentage: number | null

  @column({ consume: (v) => Boolean(v) })
  declare depositPaid: boolean

  @column()
  declare depositReceipt: string | null

  @column({ consume: (v) => Boolean(v) })
  declare totalPaid: boolean

  @column()
  declare totalReceipt: string | null

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
}
