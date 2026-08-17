import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Role from '#models/role'

/**
 * The fourth verb is `erase`, not `delete` — LucidRow declares an instance
 * method `delete(): Promise<void>`, and a column named `delete` would
 * silently shadow it (`await row.delete()` would throw "not a function" at
 * runtime, far from the cause). `erase` needs no columnName mapping.
 */
export default class RolePermission extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare module: string

  @column()
  declare roleId: number

  @column()
  declare view: boolean

  @column()
  declare create: boolean

  @column()
  declare update: boolean

  @column()
  declare erase: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => Role)
  declare role: BelongsTo<typeof Role>
}
