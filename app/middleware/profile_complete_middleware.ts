import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class ProfileCompleteMiddleware {
  async handle({ auth, response }: HttpContext, next: NextFn) {
    const user = auth.user!
    if (user.role !== 'customer' && !user.hasLoggedIn) {
      return response.forbidden({ message: 'Debés completar tu perfil antes de continuar' })
    }
    return next()
  }
}
