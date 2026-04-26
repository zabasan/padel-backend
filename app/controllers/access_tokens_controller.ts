import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import hash from '@adonisjs/core/services/hash'
import { errors } from '@adonisjs/auth'

function serializeUser(user: User) {
  return { id: user.id, fullName: user.fullName, email: user.email, role: user.role, phone: user.phone, hasLoggedIn: user.hasLoggedIn }
}

export default class AccessTokensController {
  async store({ request }: HttpContext) {
    const { identifier, password } = request.only(['identifier', 'password'])

    // Try email first, then phone.
    // For phone: strip non-digits and use suffix matching so "1159510277" matches "+541159510277"
    const digitsOnly = identifier.replace(/\D/g, '')
    let user = await User.findBy('email', identifier)

    if (!user && digitsOnly) {
      const allUsers = await User.all()
      user = allUsers.find(u => {
        if (!u.phone) return false
        const storedDigits = u.phone.replace(/\D/g, '')
        // Match if one ends with the other (handles country code prefix)
        return storedDigits.endsWith(digitsOnly) || digitsOnly.endsWith(storedDigits)
      }) || null
    }

    if (!user) {
      throw new errors.E_INVALID_CREDENTIALS('Teléfono o email no encontrado')
    }

    // For customer role check: also use suffix matching
    const phoneDigits = user.phone ? user.phone.replace(/\D/g, '') : ''
    const phoneMatches = digitsOnly.length > 0 &&
      (phoneDigits.endsWith(digitsOnly) || digitsOnly.endsWith(phoneDigits))

    if (user.role === 'customer') {
      // Customers NEVER need a password — phone number is enough
      if (!phoneMatches) {
        throw new errors.E_INVALID_CREDENTIALS('Ingresá tu número de teléfono para acceder')
      }
      // Phone matches, allow in
    } else if (!user.hasLoggedIn) {
      // Non-customer first login: phone only (admin/worker created accounts)
      if (!phoneMatches) {
        throw new errors.E_INVALID_CREDENTIALS('Debes usar tu teléfono para el primer ingreso')
      }
    } else {
      // Non-customer normal login: requires password
      if (!password) {
        throw new errors.E_INVALID_CREDENTIALS('Contraseña requerida')
      }
      const isValid = await hash.verify(user.password, password)
      if (!isValid) {
        throw new errors.E_INVALID_CREDENTIALS('Credenciales inválidas')
      }
    }

    const token = await User.accessTokens.create(user)
    return { user: serializeUser(user), token: token.value!.release() }
  }

  async destroy({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.currentAccessToken) {
      await User.accessTokens.delete(user, user.currentAccessToken.identifier)
    }
    return { message: 'Sesión cerrada correctamente' }
  }
}
