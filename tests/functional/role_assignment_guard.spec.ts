import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import {
  assertCanAssignRole,
  resolvePermissionsForUser,
  RoleAssignmentDeniedError,
} from '#services/permissions'
import { findRoleIdByName } from '#services/role_sync'
import { createAdmin, createSupervisor, createWorker } from './fixtures.js'

/**
 * D7 — the one validation on assigning a role, and the only thing that
 * makes `supervisor` (admin minus roles/user_permissions, D6) a real
 * boundary instead of a convention. Both call sites matter: guarding only
 * `update` would leave `store` as an open door — a supervisor creates a
 * brand-new admin account, and the initial password is that account's own
 * phone number (first non-customer login is phone-only), which the
 * supervisor chose and therefore knows.
 *
 * IMPORTANT scoping note: `start/routes.ts` still gates `POST/PUT /users`
 * with the OLD `role_middleware({ roles: ['admin', 'worker'] })` — Phase 1
 * deliberately leaves it untouched (rollout is group-by-group, later). That
 * gate has no idea `supervisor` exists, so a supervisor gets 403'd at the
 * ROUTE layer before ever reaching `assertRoleAssignable`. The two HTTP
 * tests below are still valid end-to-end regressions (a supervisor must
 * never be able to self-promote, full stop, for whatever combination of
 * reasons denies it) — but they do not yet prove D7 *specifically* fired.
 * D7 is proven directly, against the real DB, in the third test.
 */
test.group('role assignment guard (D7)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('supervisor cannot promote themselves to admin via PUT /users/:id (blocked today by route_middleware; D7 will also apply once this route migrates)', async ({
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

  test('supervisor cannot create a new admin account via POST /users (same route_middleware caveat as above)', async ({
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

  test('D7 directly: supervisor may be assigned worker (subset) but not admin (superset)', async ({
    assert,
  }) => {
    const supervisor = await createSupervisor()
    const adminRoleId = await findRoleIdByName('admin')
    const workerRoleId = await findRoleIdByName('worker')
    const supervisorPerms = await resolvePermissionsForUser(supervisor)

    await assertCanAssignRole(supervisorPerms, workerRoleId!) // must not throw

    let deniedError: unknown = null
    try {
      await assertCanAssignRole(supervisorPerms, adminRoleId!)
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

  test('worker (route-reachable, admin+worker group) can assign a subset role to another user', async ({
    client,
  }) => {
    const worker1 = await createWorker()
    const worker2 = await createWorker()

    const response = await client
      .put(`/api/v1/users/${worker2.id}`)
      .loginAs(worker1)
      .json({ role: 'worker' })

    response.assertStatus(200)
  })
})
