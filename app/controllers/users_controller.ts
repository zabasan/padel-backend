import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import UserAuditLog from '#models/user_audit_log'
import vine from '@vinejs/vine'
import { findRoleIdByName, getRolesCached } from '#services/role_sync'
import {
  RoleAssignmentDeniedError,
  assertCanAssignRole,
  can,
  getRequestPermissions,
  isSubsetOf,
  resolvePermissionsForUser,
} from '#services/permissions'

const PADEL_CATEGORIES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'] as const

const updateUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().optional(),
    email: vine.string().email().optional(),
    phone: vine.string().trim().optional(),
    role: vine.string().trim().optional(),
    password: vine.string().optional(),
    hasLoggedIn: vine.boolean().optional(),
    padelCategory: vine.enum(PADEL_CATEGORIES).optional().nullable(),
  })
)

// `role` used to be a hardcoded 4-value enum (admin/worker/customer/professor), which made it
// impossible to ever assign a role created through the Roles ABM (including the seeded
// `supervisor`). Any string is now syntactically valid; this checks it against the LIVE roles
// table instead, so a typo'd or deleted role name is still rejected.
async function assertRoleExists(roleName: string): Promise<boolean> {
  const roles = await getRolesCached()
  return roles.some((r) => r.name === roleName)
}

// D7: the one validation on assigning a role, applied to BOTH store and
// update — guarding only one of the two would leave the other as an open
// escalation path (e.g. create a fresh admin account with a chosen
// password). Deliberately NOT applied on the roles/user_permissions screens
// (D6) — see app/services/permissions.ts.
async function assertRoleAssignable(performer: User, roleName: string) {
  const targetRoleId = await findRoleIdByName(roleName)
  if (targetRoleId === null) return
  const actorPerms = await resolvePermissionsForUser(performer)
  await assertCanAssignRole(actorPerms, targetRoleId)
}

export class UserActionDeniedError extends Error {
  constructor() {
    super('No podés modificar a un usuario con más permisos que los tuyos')
  }
}

/**
 * No podés actuar sobre alguien con más permisos que vos.
 *
 * `assertRoleAssignable` (D7) solo mira el rol que se ASIGNA, nunca a QUIÉN se está editando.
 * Sin esta segunda comprobación, `users.update` alcanzaba para cambiarle la contraseña a un
 * administrador y entrar como él — escalada verificada en vivo. Aplica a editar, borrar,
 * desactivar y resetear el acceso.
 *
 * Actuar sobre uno mismo siempre está permitido: si no, un admin no podría editar su propia
 * ficha (su propio set nunca es subconjunto estricto de sí mismo... salvo que lo sea, pero la
 * excepción explícita evita depender de eso).
 */
async function assertCanActOnUser(performer: User, target: User) {
  if (performer.id === target.id) return
  const [actorPerms, targetPerms] = await Promise.all([
    resolvePermissionsForUser(performer),
    resolvePermissionsForUser(target),
  ])
  if (!isSubsetOf(targetPerms, actorPerms)) {
    throw new UserActionDeniedError()
  }
}

/**
 * Misma regla de visibilidad que `index()`: quien no puede borrar usuarios solo ve clientes y
 * profesores. Estaba aplicada únicamente al listado, así que `show()` y `search()` filtraban
 * la lista pero dejaban ver al admin entrando por id o buscándolo por nombre.
 */
const SELF_SERVICE_ROLES = ['customer', 'professor']

export default class UsersController {
  async store({ request, response, auth }: HttpContext) {
    const performer = auth.user!
    const data = await request.validateUsing(
      vine.compile(
        vine.object({
          fullName: vine.string().trim(),
          phone: vine.string().trim().unique({ table: 'users', column: 'phone' }),
          email: vine.string().email().optional(),
          role: vine.string().trim().optional(),
          padelCategory: vine.enum(PADEL_CATEGORIES).optional().nullable(),
        })
      )
    )

    const role = data.role || 'customer'

    if (!(await assertRoleExists(role))) {
      return response.unprocessableEntity({ message: `El rol "${role}" no existe` })
    }

    if (role !== 'customer' && !data.email) {
      return response.unprocessableEntity({
        message: 'El email es obligatorio para empleados, profesores y administradores',
      })
    }

    try {
      await assertRoleAssignable(performer, role)
    } catch (error) {
      if (error instanceof RoleAssignmentDeniedError) {
        return response.forbidden({ message: error.message })
      }
      throw error
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

  async resetLogin({ params, auth, response }: HttpContext) {
    const performer = auth.user!
    const user = await User.findOrFail(params.id)
    try {
      await assertCanActOnUser(performer, user)
    } catch (error) {
      if (error instanceof UserActionDeniedError) return response.forbidden({ message: error.message })
      throw error
    }

    user.hasLoggedIn = false
    if (user.phone) {
      user.password = user.phone
    }
    await user.save()
    return response.ok({ message: 'Login reseteado correctamente', phone: user.phone })
  }

  async index(ctx: HttpContext) {
    const { request, response } = ctx
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))
    const roleFilter = request.input('role')
    const rolesFilter = String(request.input('roles', '') || '').trim()
    const category = request.input('category')
    const search = String(request.input('search', '') || '').trim()

    const query = User.query().select([
      'id',
      'full_name',
      'email',
      'role',
      'status',
      'phone',
      'padel_category',
      'created_at',
    ])

    // Whoever cannot erase users (today: everyone but admin — same effective access as the
    // old `performer.role !== 'admin'` check, but this now works for custom roles too) only
    // sees customers and professors.
    const perms = await getRequestPermissions(ctx)
    if (!can(perms, 'users', 'erase')) {
      query.whereIn('role', SELF_SERVICE_ROLES)
    }

    if (roleFilter) query.where('role', roleFilter)
    // Multi-role filter (CSV), e.g. roles=admin,worker for staff-only pickers.
    if (rolesFilter) {
      const roles = rolesFilter
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
      if (roles.length) query.whereIn('role', roles)
    }

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
  async search(ctx: HttpContext) {
    const { request, response } = ctx
    const q = String(request.input('q', '') || '').trim()
    if (q.length < 3) return response.ok([])

    const query = User.query().select([
      'id',
      'full_name',
      'email',
      'role',
      'phone',
      'padel_category',
    ])
    if (/[a-zA-Z]/.test(q)) {
      query.where('full_name', 'like', `%${q}%`)
    } else {
      const digits = q.replace(/\D/g, '')
      if (!digits) return response.ok([])
      query.where('phone', 'like', `%${digits}%`)
    }

    // Misma restricción que index(): sin `users.erase` solo se ven clientes y profesores.
    const perms = await getRequestPermissions(ctx)
    if (!can(perms, 'users', 'erase')) {
      query.whereIn('role', SELF_SERVICE_ROLES)
    }

    const users = await query.orderBy('full_name', 'asc').limit(15)
    return response.ok(users)
  }

  async show(ctx: HttpContext) {
    const { params, response } = ctx
    const query = User.query()
      .select(['id', 'full_name', 'email', 'role', 'phone', 'padel_category', 'created_at'])
      .where('id', params.id)

    // Sin `users.erase` no se puede espiar la ficha de un admin entrando directo por id.
    const perms = await getRequestPermissions(ctx)
    if (!can(perms, 'users', 'erase')) {
      query.whereIn('role', SELF_SERVICE_ROLES)
    }

    const user = await query.firstOrFail()
    return response.ok(user)
  }

  async update({ params, request, auth, response }: HttpContext) {
    const performer = auth.user!
    const user = await User.findOrFail(params.id)

    // A QUIÉN estoy editando. Sin esto, un empleado podía cambiarle la contraseña a un
    // administrador y entrar como él.
    try {
      await assertCanActOnUser(performer, user)
    } catch (error) {
      if (error instanceof UserActionDeniedError) return response.forbidden({ message: error.message })
      throw error
    }

    const data = await request.validateUsing(updateUserValidator)

    if (data.role !== undefined) {
      if (!(await assertRoleExists(data.role))) {
        return response.unprocessableEntity({ message: `El rol "${data.role}" no existe` })
      }
      try {
        await assertRoleAssignable(performer, data.role)
      } catch (error) {
        if (error instanceof RoleAssignmentDeniedError) {
          return response.forbidden({ message: error.message })
        }
        throw error
      }
    }

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
        logs.map((l) => ({ performedBy: performer.id, targetUserId: user.id, ...l }))
      )
    }

    return response.ok({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      roleId: user.roleId,
      phone: user.phone,
      padelCategory: user.padelCategory,
      hasLoggedIn: Boolean(user.hasLoggedIn),
      isSuperUser: Boolean(user.isSuperUser),
    })
  }

  async toggleStatus({ params, auth, response }: HttpContext) {
    const performer = auth.user!
    const user = await User.findOrFail(params.id)
    try {
      await assertCanActOnUser(performer, user)
    } catch (error) {
      if (error instanceof UserActionDeniedError) return response.forbidden({ message: error.message })
      throw error
    }

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

  async destroy({ params, auth, response }: HttpContext) {
    const performer = auth.user!
    const user = await User.findOrFail(params.id)
    try {
      await assertCanActOnUser(performer, user)
    } catch (error) {
      if (error instanceof UserActionDeniedError) return response.forbidden({ message: error.message })
      throw error
    }

    await user.delete()
    return response.ok({ message: 'Usuario eliminado correctamente' })
  }
}
