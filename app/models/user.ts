import { UserSchema } from '#database/schema'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { AccessToken } from '@adonisjs/auth/access_tokens'
import hash from '@adonisjs/core/services/hash'
import { belongsTo, beforeSave, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Reservation from '#models/reservation'
import Role from '#models/role'
import { getRolesCached, resolveRoleSync } from '#services/role_sync'

export default class User extends UserSchema {
  static accessTokens = DbAccessTokensProvider.forModel(User)
  declare currentAccessToken?: AccessToken

  // Widened from the old 4-value union now that custom roles can exist.
  // `role` is KEPT (not replaced by roleId) for backward compatibility with
  // role_middleware and the frontend's PrivateRoute during the RBAC rollout.
  declare role: string

  @column()
  declare roleId: number | null

  @column()
  declare status: 'active' | 'inactive'

  @column()
  declare isSuperUser: boolean

  @column()
  declare padelCategory: string | null

  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password) {
      user.password = await hash.make(user.password)
    }
  }

  /**
   * Keeps `role` and `roleId` in sync in both directions — see
   * app/services/role_sync.ts for the pure resolution logic and why this is
   * an application hook rather than a DB trigger. $dirty-guarded so a normal
   * save (name, phone, password) costs zero extra queries.
   */
  @beforeSave()
  static async syncRoleWithRoleId(user: User) {
    const roleIdDirty = 'roleId' in user.$dirty
    const roleDirty = 'role' in user.$dirty
    if (!roleIdDirty && !roleDirty) return

    const roles = await getRolesCached()
    const result = resolveRoleSync(
      { roleIdDirty, roleDirty, roleId: user.roleId, role: user.role },
      roles
    )
    user.role = result.role
    user.roleId = result.roleId
  }

  // Cannot be named `role` — that's the existing string column.
  @belongsTo(() => Role, { foreignKey: 'roleId' })
  declare roleRecord: BelongsTo<typeof Role>

  @hasMany(() => Reservation)
  declare reservations: HasMany<typeof Reservation>

  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
