import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import User from '#models/user'

/**
 * Table is `users_permissions` (owner's schema), NOT the `user_permissions`
 * Lucid would infer from the class name — must be declared explicitly or
 * every query silently targets the wrong table.
 *
 * Same `erase`-not-`delete` reasoning as RolePermission.
 */
export default class UserPermission extends BaseModel {
  static table = 'users_permissions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare module: string

  @column()
  declare userId: number

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

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
