import { test } from '@japa/runner'
import { can, type PermissionAction } from '#services/permissions'
import { ROLE_PERMISSION_MATRIX, MODULE_NAMES } from '#database/seed_data/permission_matrix'

/**
 * The regression net. Encodes routes.ts's role gates as they exist TODAY
 * (before this migration) and asserts the seeded matrix grants access to
 * exactly those roles, for exactly those routes — the single test proving
 * nobody gained or lost access in the cutover.
 *
 * `supervisor` is deliberately excluded here — it has no equivalent today.
 * It gets its own assertion below instead.
 */

const PRE_EXISTING_ROLES = ['admin', 'worker', 'customer', 'professor'] as const

interface RouteExpectation {
  route: string
  module: string
  action: PermissionAction
  /**
   * Alternativa OR de la ruta (`middleware.permission({ ..., or: {...} })`): cumplir
   * cualquiera de los dos pares habilita el acceso. Solo la usan los listados que alimentan
   * más de una pantalla.
   */
  or?: { module: string; action: PermissionAction }
  rolesAllowedToday: readonly (typeof PRE_EXISTING_ROLES)[number][]
}

const ROUTE_TABLE: RouteExpectation[] = [
  {
    route: 'POST courts',
    module: 'courts',
    action: 'create',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PUT courts/:id',
    module: 'courts',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'DELETE courts/:id',
    module: 'courts',
    action: 'erase',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PATCH courts/:id/toggle',
    module: 'courts',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PUT courts/:id/price-ranges',
    module: 'courts',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },

  {
    route: 'GET reservations',
    module: 'reservations',
    action: 'view',
    rolesAllowedToday: ['admin', 'worker', 'customer', 'professor'],
  },
  {
    route: 'GET reservations/:id',
    module: 'reservations',
    action: 'view',
    rolesAllowedToday: ['admin', 'worker', 'customer', 'professor'],
  },
  {
    route: 'POST reservations',
    module: 'reservations',
    action: 'create',
    rolesAllowedToday: ['admin', 'worker', 'customer', 'professor'],
  },
  {
    route: 'PUT reservations/:id',
    module: 'reservations',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker', 'customer', 'professor'],
  },
  {
    route: 'DELETE reservations/:id',
    module: 'reservations',
    action: 'erase',
    rolesAllowedToday: ['admin', 'worker', 'customer', 'professor'],
  },

  {
    route: 'PATCH reservations/:id/hide-next',
    module: 'reservation_management',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PATCH reservations/:id/show-next',
    module: 'reservation_management',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'GET reservations/:id/audit',
    module: 'reservation_management',
    action: 'view',
    rolesAllowedToday: ['admin', 'worker'],
  },
  // Route group is admin+worker, but revert() has an inline `user.role !== 'admin'` guard
  // (reservations_controller.ts:1499) that makes EFFECTIVE access admin-only. The permission
  // grant reproduces the effective access, not the route wrapper — the inline guard then
  // becomes redundant defense-in-depth on top of an already-correct grant.
  {
    route: 'PATCH reservations/:id/revert',
    module: 'reservation_management',
    action: 'erase',
    rolesAllowedToday: ['admin'],
  },

  {
    route: 'PATCH reservations/:id/pay-deposit',
    module: 'payments',
    action: 'create',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PATCH reservations/:id/pay-total',
    module: 'payments',
    action: 'create',
    rolesAllowedToday: ['admin', 'worker'],
  },
  // Same inline-guard situation: revertPayment()/revertAllPayments() both check
  // `user.role !== 'admin'` (reservations_controller.ts:1516, 1562) despite the admin+worker
  // route group.
  {
    route: 'DELETE reservations/:id/payments/:paymentId',
    module: 'payments',
    action: 'erase',
    rolesAllowedToday: ['admin'],
  },
  {
    route: 'DELETE reservations/:id/payments',
    module: 'payments',
    action: 'erase',
    rolesAllowedToday: ['admin'],
  },

  {
    route: 'POST users',
    module: 'users',
    action: 'create',
    rolesAllowedToday: ['admin', 'worker'],
  },
  { route: 'GET users', module: 'users', action: 'view', rolesAllowedToday: ['admin', 'worker'] },
  {
    route: 'GET users/search',
    module: 'users',
    action: 'view',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'GET users/:id',
    module: 'users',
    action: 'view',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PUT users/:id',
    module: 'users',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'POST users/:id/reset-login',
    module: 'users',
    action: 'update',
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'PATCH users/:id/toggle-status',
    module: 'users',
    action: 'erase',
    rolesAllowedToday: ['admin'],
  },
  { route: 'DELETE users/:id', module: 'users', action: 'erase', rolesAllowedToday: ['admin'] },

  { route: 'GET stats', module: 'stats', action: 'view', rolesAllowedToday: ['admin'] },
  { route: 'PUT settings', module: 'settings', action: 'update', rolesAllowedToday: ['admin'] },
  { route: 'GET audit/users', module: 'audit', action: 'view', rolesAllowedToday: ['admin'] },
  {
    route: 'GET audit/reservations',
    module: 'audit',
    action: 'view',
    rolesAllowedToday: ['admin'],
  },

  // Roles ABM + per-user permission extras (new in this migration). Among the 4
  // PRE_EXISTING_ROLES only `admin` ever held `roles`/`user_permissions` (see
  // ROLE_PERMISSION_MATRIX and supervisor's own dedicated test below) — worker,
  // customer and professor all hold p('') on both, same as before these routes existed.
  // Estos dos listados llevan un OR porque también alimentan la pantalla de Usuarios (ver
  // routes.ts). `worker` entra a GET roles por `users.view`: necesita los nombres de rol para
  // los <select> del alta y la edición. Sigue sin poder escribir nada del ABM.
  {
    route: 'GET roles',
    module: 'roles',
    action: 'view',
    or: { module: 'users', action: 'view' },
    rolesAllowedToday: ['admin', 'worker'],
  },
  {
    route: 'GET modules',
    module: 'roles',
    action: 'view',
    or: { module: 'user_permissions', action: 'view' },
    rolesAllowedToday: ['admin'],
  },
  { route: 'GET roles/:id', module: 'roles', action: 'view', rolesAllowedToday: ['admin'] },
  { route: 'POST roles', module: 'roles', action: 'create', rolesAllowedToday: ['admin'] },
  { route: 'PUT roles/:id', module: 'roles', action: 'update', rolesAllowedToday: ['admin'] },
  { route: 'DELETE roles/:id', module: 'roles', action: 'erase', rolesAllowedToday: ['admin'] },
  {
    route: 'GET users/:id/permissions',
    module: 'user_permissions',
    action: 'view',
    rolesAllowedToday: ['admin'],
  },
  {
    route: 'PUT users/:id/permissions',
    module: 'user_permissions',
    action: 'update',
    rolesAllowedToday: ['admin'],
  },
]

test.group("permission matrix — reproduces today's access exactly", () => {
  test("every route x every pre-existing role matches today's effective access", ({ assert }) => {
    for (const expectation of ROUTE_TABLE) {
      for (const role of PRE_EXISTING_ROLES) {
        const shouldAllow = (expectation.rolesAllowedToday as readonly string[]).includes(role)
        const actuallyAllows =
          can(ROLE_PERMISSION_MATRIX[role], expectation.module, expectation.action) ||
          (expectation.or !== undefined &&
            can(ROLE_PERMISSION_MATRIX[role], expectation.or.module, expectation.or.action))
        const gate = expectation.or
          ? `${expectation.module}.${expectation.action} OR ${expectation.or.module}.${expectation.or.action}`
          : `${expectation.module}.${expectation.action}`
        assert.equal(
          actuallyAllows,
          shouldAllow,
          `${expectation.route} (${gate}) for role "${role}": expected ${shouldAllow}, got ${actuallyAllows}`
        )
      }
    }
  })

  test('every module in the route table exists in the catalog', ({ assert }) => {
    const modulesUsed = new Set(ROUTE_TABLE.map((r) => r.module))
    for (const moduleName of modulesUsed) {
      assert.include(MODULE_NAMES, moduleName)
    }
  })
})

test.group('permission matrix — supervisor', () => {
  test('supervisor equals admin minus roles and user_permissions, nothing else differs', ({
    assert,
  }) => {
    const admin = ROLE_PERMISSION_MATRIX.admin
    const supervisor = ROLE_PERMISSION_MATRIX.supervisor

    for (const moduleName of MODULE_NAMES) {
      if (moduleName === 'roles' || moduleName === 'user_permissions') {
        assert.deepEqual(
          supervisor[moduleName],
          { view: false, create: false, update: false, erase: false },
          `supervisor should hold nothing on "${moduleName}"`
        )
      } else {
        assert.deepEqual(
          supervisor[moduleName],
          admin[moduleName],
          `supervisor should match admin exactly on "${moduleName}"`
        )
      }
    }
  })
})
