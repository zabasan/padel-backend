import type { HttpContext } from '@adonisjs/core/http'

export default class ProfileController {
  async show({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      hasLoggedIn: Boolean(user.hasLoggedIn),
      isSuperUser: Boolean(user.isSuperUser),
    }
  }
}
