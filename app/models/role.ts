import { BaseModel, afterDelete, afterSave, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import RolePermission from '#models/role_permission'
import { invalidateRoleCache } from '#services/role_sync'

export default class Role extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @hasMany(() => RolePermission)
  declare permissions: HasMany<typeof RolePermission>

  @afterSave()
  static invalidateCacheOnSave() {
    invalidateRoleCache()
  }

  @afterDelete()
  static invalidateCacheOnDelete() {
    invalidateRoleCache()
  }
}
