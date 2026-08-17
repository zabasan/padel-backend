import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import { serializeSessionUser } from '#transformers/user_session'

export default class NewAccountController {
  async store({ request }: HttpContext) {
    const { fullName, email, password, phone, padelCategory } = await request.validateUsing(signupValidator)
    const user = await User.create({ fullName, email, password, phone, role: 'customer', padelCategory: padelCategory ?? null })
    const token = await User.accessTokens.create(user)
    return {
      user: await serializeSessionUser(user),
      token: token.value!.release(),
    }
  }
}
