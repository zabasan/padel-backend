import User from '#models/user'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class NewAccountController {
  async store({ request }: HttpContext) {
    const { fullName, email, password, phone } = await request.validateUsing(signupValidator)
    const user = await User.create({ fullName, email, password, phone, role: 'customer' })
    const token = await User.accessTokens.create(user)
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        phone: user.phone,
      },
      token: token.value!.release(),
    }
  }
}
