import type { HttpContext } from '@adonisjs/core/http'
import { serializeSessionUser } from '#transformers/user_session'

export default class ProfileController {
  async show({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    return serializeSessionUser(user)
  }
}
