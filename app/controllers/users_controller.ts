import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import UserAuditLog from '#models/user_audit_log'
import vine from '@vinejs/vine'
import hash from '@adonisjs/core/services/hash'

const PADEL_CATEGORIES = ['C1','C2','C3','C4','C5','C6','C7','C8','C9'] as const

const updateUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().optional(),
    email: vine.string().email().optional(),
    phone: vine.string().trim().optional(),
    role: vine.enum(['admin', 'worker', 'customer'] as const).optional(),
    password: vine.string().optional(),
    hasLoggedIn: vine.boolean().optional(),
    padelCategory: vine.enum(PADEL_CATEGORIES).optional().nullable(),
  })
)

export default class UsersController {
  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(
      vine.compile(vine.object({
        fullName: vine.string().trim(),
        phone: vine.string().trim().unique({ table: 'users', column: 'phone' }),
        role: vine.enum(['admin', 'worker', 'customer'] as const).optional(),
        padelCategory: vine.enum(PADEL_CATEGORIES).optional().nullable(),
      }))
    )

    // Use phone as password by default
    const password = await hash.make(data.phone)

    const user = await User.create({
      fullName: data.fullName,
      phone: data.phone,
      password,
      role: data.role || 'customer',
      email: `${data.phone}@padel.temp`,
      hasLoggedIn: false,
      padelCategory: data.padelCategory ?? null,
    })

    return response.created({
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      padelCategory: user.padelCategory,
      hasLoggedIn: false,
      tempPassword: data.phone,
    })
  }

  async resetLogin({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    user.hasLoggedIn = false
    
    // Also reset password to their phone number just in case
    if (user.phone) {
      user.password = await hash.make(user.phone)
    }
    
    await user.save()
    return response.ok({ message: 'Login reseteado correctamente', phone: user.phone })
  }

  async index({ response }: HttpContext) {
    const users = await User.query().select(['id', 'full_name', 'email', 'role', 'phone', 'padel_category', 'created_at'])
    return response.ok(users)
  }

  async show({ params, response }: HttpContext) {
    const user = await User.query()
      .select(['id', 'full_name', 'email', 'role', 'phone', 'padel_category', 'created_at'])
      .where('id', params.id)
      .firstOrFail()
    return response.ok(user)
  }

  async update({ params, request, auth, response }: HttpContext) {
    const performer = auth.user!
    const user = await User.findOrFail(params.id)
    const data = await request.validateUsing(updateUserValidator)

    const auditableFields = ['fullName', 'phone', 'role', 'padelCategory'] as const
    const logs: { field: string; oldValue: string | null; newValue: string | null }[] = []

    for (const field of auditableFields) {
      if (data[field] !== undefined) {
        const oldVal = String(user[field] ?? '')
        const newVal = String(data[field] ?? '')
        if (oldVal !== newVal) {
          logs.push({ field, oldValue: oldVal || null, newValue: newVal || null })
        }
      }
    }

    if (data.password) {
      data.password = await hash.make(data.password)
    }

    user.merge(data)
    await user.save()

    if (logs.length > 0) {
      await UserAuditLog.createMany(
        logs.map(l => ({ performedBy: performer.id, targetUserId: user.id, ...l }))
      )
    }

    return response.ok({ id: user.id, fullName: user.fullName, email: user.email, role: user.role, phone: user.phone, padelCategory: user.padelCategory, hasLoggedIn: user.hasLoggedIn })
  }

  async destroy({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await user.delete()
    return response.ok({ message: 'Usuario eliminado correctamente' })
  }
}
