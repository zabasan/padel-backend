import { UserSchema } from '#database/schema'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { AccessToken } from '@adonisjs/auth/access_tokens'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Reservation from '#models/reservation'

export default class User extends UserSchema {
  static accessTokens = DbAccessTokensProvider.forModel(User)
  declare currentAccessToken?: AccessToken

  declare role: 'admin' | 'worker' | 'customer'

  @hasMany(() => Reservation)
  declare reservations: HasMany<typeof Reservation>

  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
