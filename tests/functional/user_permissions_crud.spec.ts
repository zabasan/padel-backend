import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createAdmin, createRoleWithPermissions, createUserWithPermissions } from './fixtures.js'
import { MODULE_NAMES } from '#database/seed_data/permission_matrix'
import type { PermissionMap } from '#services/permissions'

function emptyGrid(): PermissionMap {
  const grid: PermissionMap = {}
  for (const moduleName of MODULE_NAMES) {
    grid[moduleName] = { view: false, create: false, update: false, erase: false }
  }
  return grid
}

/**
 * The subject is a user on a PURPOSE-BUILT role granting `reservations.view` and
 * nothing on `stats` — the two modules these tests need on opposite sides of the
 * merge. Reading those facts off `worker`'s seeded grid instead made both tests
 * hostage to a business decision: retuning worker in the Roles ABM (a supported,
 * expected action) broke them with nothing actually wrong.
 */
async function createSubject() {
  const role = await createRoleWithPermissions({ reservations: { view: true } })
  return createUserWithPermissions({}, { role })
}

test.group('user permissions CRUD (admin)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET returns roleGrid, userGrid and effective as three separate layers', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const subject = await createSubject()

    const response = await client.get(`/api/v1/users/${subject.id}/permissions`).loginAs(admin)
    response.assertStatus(200)
    const { roleGrid, userGrid, effective } = response.body() as any

    // the role grants reservations.view and holds nothing on stats.
    assert.isTrue(roleGrid.reservations.view)
    assert.isFalse(roleGrid.stats.view)

    // a brand-new user has no extras yet.
    for (const moduleName of MODULE_NAMES) {
      assert.isFalse(userGrid[moduleName].view, `expected no extra view grant on ${moduleName}`)
    }

    // with no extras, effective must equal the role grid exactly.
    assert.deepEqual(effective, roleGrid)
  })

  test('PUT writes only userGrid, and a false extra never revokes a role grant (OR merge, D3)', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const subject = await createSubject()

    const grid = emptyGrid()
    // the role does NOT grant stats.view — extend it via a user-level extra.
    grid.stats = { view: true, create: false, update: false, erase: false }
    // the role ALREADY grants reservations.view — send an explicit false extra for it.
    grid.reservations = { view: false, create: false, update: false, erase: false }

    const put = await client
      .put(`/api/v1/users/${subject.id}/permissions`)
      .loginAs(admin)
      .json({ grid })
    put.assertStatus(200)

    const { roleGrid, userGrid, effective } = put.body() as any

    // the new extra took effect.
    assert.isTrue(userGrid.stats.view)
    assert.isTrue(effective.stats.view)

    // the central case: role still grants reservations.view, the stored user
    // row for it is false, and effective is STILL true — a false user row
    // cannot revoke what the role already grants.
    assert.isTrue(roleGrid.reservations.view)
    assert.isFalse(userGrid.reservations.view)
    assert.isTrue(effective.reservations.view)

    // confirm it also persisted — a second GET returns the same picture.
    const getAgain = await client.get(`/api/v1/users/${subject.id}/permissions`).loginAs(admin)
    getAgain.assertStatus(200)
    const getAgainBody = getAgain.body() as any
    assert.isTrue(getAgainBody.effective.stats.view)
    assert.isTrue(getAgainBody.effective.reservations.view)
  })
})
