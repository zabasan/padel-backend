import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import {
  assertCanAssignRole,
  resolvePermissionsForUser,
  RoleAssignmentDeniedError,
} from '#services/permissions'
import {
  createAdmin,
  createRoleWithPermissions,
  createSupervisor,
  createUserWithPermissions,
} from './fixtures.js'

/**
 * D7 — the one validation on assigning a role, and the only thing that
 * makes `supervisor` (admin minus roles/user_permissions, D6) a real
 * boundary instead of a convention. Both call sites matter: guarding only
 * `update` would leave `store` as an open door — a supervisor creates a
 * brand-new admin account, and the initial password is that account's own
 * phone number (first non-customer login is phone-only), which the
 * supervisor chose and therefore knows.
 *
 * The two HTTP tests keep naming `supervisor` and `admin` deliberately: they
 * encode the concrete scenario the security audit turned up, and it is worth
 * reading as that scenario rather than as an abstract subset comparison. They
 * are also the one place a seeded role name is safe here — the only ABM change
 * that could flip them is granting supervisor everything admin holds, at which
 * point "supervisor cannot become admin" is vacuous rather than wrong.
 *
 * D7's actual rule (a subset comparison) is proven on purpose-built roles in
 * the third test, so retuning any seeded role cannot mask a regression in it.
 *
 * Note for future readers: an earlier version of this comment said these routes
 * were still gated by `role_middleware({ roles: [...] })`, so a supervisor was
 * bounced at the route layer before reaching `assertRoleAssignable`. That is no
 * longer true — the RBAC rollout finished and `routes.ts` carries no
 * `middleware.role` at all (it stays registered in kernel.ts but gates nothing).
 * These two tests therefore DO prove D7 fired: nothing else denies them.
 */
test.group('role assignment guard (D7)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('supervisor cannot promote themselves to admin via PUT /users/:id', async ({
    client,
    assert,
  }) => {
    const supervisor = await createSupervisor()

    const response = await client
      .put(`/api/v1/users/${supervisor.id}`)
      .loginAs(supervisor)
      .json({ role: 'admin' })

    response.assertStatus(403)
    await supervisor.refresh()
    assert.equal(supervisor.role, 'supervisor')
  })

  test('supervisor cannot create a new admin account via POST /users', async ({
    client,
    assert,
  }) => {
    const supervisor = await createSupervisor()

    const response = await client.post('/api/v1/users').loginAs(supervisor).json({
      fullName: 'Shadow Admin',
      phone: '5511119999',
      email: 'shadow@example.test',
      role: 'admin',
    })

    response.assertStatus(403)
    const created = await User.findBy('phone', '5511119999')
    assert.isNull(created)
  })

  /**
   * D7 in isolation, on purpose-built roles rather than seeded ones.
   *
   * Framed as "supervisor may be assigned worker but not admin", this read as a test of
   * D7 but actually asserted the seeded roles' relative ordering — a business decision.
   * Granting worker more through the Roles ABM inverted that ordering and turned this
   * red while D7 itself was working perfectly. The rule is a subset comparison, so the
   * inputs are now two roles built to be a subset and a superset of the actor.
   */
  test('D7 directly: a subset role is assignable, a superset role is not', async ({ assert }) => {
    const actorRole = await createRoleWithPermissions({
      users: { view: true, create: true, update: true },
      stats: { view: true },
    })
    const actor = await createUserWithPermissions({}, { role: actorRole })

    const subsetRole = await createRoleWithPermissions({ users: { view: true } })
    const supersetRole = await createRoleWithPermissions({
      users: { view: true, create: true, update: true, erase: true },
      stats: { view: true },
      settings: { view: true, update: true },
    })

    const actorPerms = await resolvePermissionsForUser(actor)

    await assertCanAssignRole(actorPerms, subsetRole.id) // must not throw

    let deniedError: unknown = null
    try {
      await assertCanAssignRole(actorPerms, supersetRole.id)
    } catch (error) {
      deniedError = error
    }
    assert.instanceOf(deniedError, RoleAssignmentDeniedError)
  })

  test('admin can assign any role, including to themselves, end-to-end over HTTP', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()

    const response = await client
      .put(`/api/v1/users/${admin.id}`)
      .loginAs(admin)
      .json({ role: 'admin' })

    response.assertStatus(200)
    await admin.refresh()
    assert.equal(admin.role, 'admin')
  })

  // End-to-end over HTTP, without going through admin: someone holding `users.update`
  // can assign a role they already cover. The actor and the role assigned share one
  // grid, so it is a subset of itself — the boundary D7 allows.
  test('a users.update holder can assign a role it already covers, over HTTP', async ({
    client,
  }) => {
    const grants = { users: { view: true, update: true } }
    const assignableRole = await createRoleWithPermissions(grants)
    const actor = await createUserWithPermissions({}, { role: assignableRole })
    const target = await createUserWithPermissions({}, { role: assignableRole })

    const response = await client
      .put(`/api/v1/users/${target.id}`)
      .loginAs(actor)
      .json({ role: assignableRole.name })

    response.assertStatus(200)
  })
})
