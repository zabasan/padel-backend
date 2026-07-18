import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import UserAuditLog from '#models/user_audit_log'
import vine from '@vinejs/vine'

const PADEL_CATEGORIES = ['C1','C2','C3','C4','C5','C6','C7','C8','C9'] as const
const ROLES = ['admin', 'worker', 'customer', 'professor'] as const

const updateUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().optional(),
    email: vine.string().email().optional(),
    phone: vine.string().trim().optional(),
    role: vine.enum(ROLES).optional(),
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
        email: vine.string().email().optional(),
        role: vine.enum(ROLES).optional(),
        padelCategory: vine.enum(PADEL_CATEGORIES).optional().nullable(),
      }))
    )

    const role = data.role || 'customer'

    if (role !== 'customer' && !data.email) {
      return response.unprocessableEntity({ message: 'El email es obligatorio para empleados, profesores y administradores' })
    }

    const user = await User.create({
      fullName: data.fullName,
      phone: data.phone,
      password: data.phone,
      role,
      email: data.email || `${data.phone}@padel.temp`,
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
    if (user.phone) {
      user.password = user.phone
    }
    await user.save()
    return response.ok({ message: 'Login reseteado correctamente', phone: user.phone })
  }

  async index({ request, response, auth }: HttpContext) {
    const performer = auth.user!
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))
    const roleFilter = request.input('role')
    const category = request.input('category')
    const search = String(request.input('search', '') || '').trim()

    const query = User.query().select(['id', 'full_name', 'email', 'role', 'status', 'phone', 'padel_category', 'created_at'])

    // Workers only see customers and professors; admins see everyone.
    if (performer.role !== 'admin') {
      query.whereIn('role', ['customer', 'professor'])
    }

    if (roleFilter) query.where('role', roleFilter)

    if (category === 'null') query.whereNull('padel_category')
    else if (category) query.where('padel_category', category)

    // Search by name, email or phone. Digits are matched against phone (whatsapp).
    if (search) {
      const digits = search.replace(/\D/g, '')
      query.where((q) => {
        q.where('full_name', 'like', `%${search}%`).orWhere('email', 'like', `%${search}%`)
        if (digits) q.orWhere('phone', 'like', `%${digits}%`)
      })
    }

    query.orderBy('full_name', 'asc')

    const users = await query.paginate(page, perPage)
    return response.ok(users.toJSON())
  }

  // Lightweight autocomplete for assigning a customer to a reservation. Letters search the
  // name; digits search the phone/whatsapp. Requires at least 3 characters.
  async search({ request, response }: HttpContext) {
    const q = String(request.input('q', '') || '').trim()
    if (q.length < 3) return response.ok([])

    const query = User.query().select(['id', 'full_name', 'email', 'role', 'phone', 'padel_category'])
    if (/[a-zA-Z]/.test(q)) {
      query.where('full_name', 'like', `%${q}%`)
    } else {
      const digits = q.replace(/\D/g, '')
      if (!digits) return response.ok([])
      query.where('phone', 'like', `%${digits}%`)
    }

    const users = await query.orderBy('full_name', 'asc').limit(15)
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

    const auditableFields = ['fullName', 'email', 'phone', 'role', 'padelCategory'] as const
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
      logs.push({ field: 'password', oldValue: '(encriptada)', newValue: '(nueva encriptada)' })
    }

    user.merge(data)
    await user.save()

    if (logs.length > 0) {
      await UserAuditLog.createMany(
        logs.map(l => ({ performedBy: performer.id, targetUserId: user.id, ...l }))
      )
    }

    return response.ok({ id: user.id, fullName: user.fullName, email: user.email, role: user.role, phone: user.phone, padelCategory: user.padelCategory, hasLoggedIn: Boolean(user.hasLoggedIn), isSuperUser: Boolean(user.isSuperUser) })
  }

  async toggleStatus({ params, auth, response }: HttpContext) {
    const performer = auth.user!
    const user = await User.findOrFail(params.id)
    const oldStatus = user.status ?? 'active'
    user.status = oldStatus === 'active' ? 'inactive' : 'active'
    await user.save()
    await UserAuditLog.create({
      performedBy: performer.id,
      targetUserId: user.id,
      field: 'status',
      oldValue: oldStatus,
      newValue: user.status,
    })
    return response.ok({ id: user.id, status: user.status })
  }

  async destroy({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await user.delete()
    return response.ok({ message: 'Usuario eliminado correctamente' })
  }
}
