import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class NewAccountController {
  async store({ request }: HttpContext) {
    const { fullName, email, password, phone, padelCategory } = await request.validateUsing(signupValidator)
    const user = await User.create({ fullName, email, password, phone, role: 'customer', padelCategory: padelCategory ?? null })
    const token = await User.accessTokens.create(user)
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        padelCategory: user.padelCategory,
      },
      token: token.value!.release(),
    }
  }
}
