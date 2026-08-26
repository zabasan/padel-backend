import type { HttpContext } from '@adonisjs/core/http'
import vine, { SimpleMessagesProvider } from '@vinejs/vine'

export default class CompleteProfileController {
  async store({ auth, request, response }: HttpContext) {
    const user = auth.user!

    if (user.role === 'customer') {
      return response.forbidden({ message: 'Acción no permitida' })
    }

    const data = await request.validateUsing(
      vine.compile(
        vine.object({
          password: vine.string().minLength(6),
          email: vine.string().email().optional(),
        })
      ),
      {
        messagesProvider: new SimpleMessagesProvider({
          minLength: 'La contraseña debe tener al menos 6 caracteres',
          email: 'El email no tiene un formato válido',
        }),
      }
    )

    user.password = data.password
    if (data.email) user.email = data.email
    user.hasLoggedIn = true
    await user.save()

    return response.ok({ message: 'Perfil completado correctamente' })
  }
}
