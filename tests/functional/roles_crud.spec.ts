import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createAdmin, createWorker } from './fixtures.js'
import { findRoleIdByName } from '#services/role_sync'
import { MODULE_NAMES } from '#database/seed_data/permission_matrix'
import type { PermissionMap } from '#services/permissions'

// Builds a full 10-module grid, granting every action on the listed modules and
// nothing elsewhere — enough to drive the CRUD endpoints without hand-writing
// all 10 module entries in every test.
function fullGrid(grantedModules: string[] = []): PermissionMap {
  const grid: PermissionMap = {}
  for (const moduleName of MODULE_NAMES) {
    const grant = grantedModules.includes(moduleName)
    grid[moduleName] = { view: grant, create: grant, update: grant, erase: grant }
  }
  return grid
}

test.group('roles CRUD (admin)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin can create, read, update and soft-delete a custom role', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()

    const create = await client
      .post('/api/v1/roles')
      .loginAs(admin)
      .json({
        name: 'Encargado de kiosco',
        description: 'Rol de prueba',
        grid: fullGrid(['reservations', 'courts']),
      })
    create.assertStatus(201)
    const body = create.body() as any
    const roleId = body.id
    assert.equal(body.name, 'Encargado de kiosco')
    assert.equal(body.description, 'Rol de prueba')
    assert.isTrue(body.grid.reservations.view)
    assert.isFalse(body.grid.users.view)

    const show = await client.get(`/api/v1/roles/${roleId}`).loginAs(admin)
    show.assertStatus(200)
    assert.equal((show.body() as any).description, 'Rol de prueba')

    const update = await client
      .put(`/api/v1/roles/${roleId}`)
      .loginAs(admin)
      .json({ description: 'Actualizado', grid: fullGrid(['courts']) })
    update.assertStatus(200)
    const updateBody = update.body() as any
    assert.equal(updateBody.description, 'Actualizado')
    assert.isFalse(updateBody.grid.reservations.view)
    assert.isTrue(updateBody.grid.courts.view)

    const destroy = await client.delete(`/api/v1/roles/${roleId}`).loginAs(admin)
    destroy.assertStatus(200)

    const showAfter = await client.get(`/api/v1/roles/${roleId}`).loginAs(admin)
    showAfter.assertStatus(404)
  })

  test('GET /roles lists live roles with usersCount, permissionsCount and modulesCount', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const response = await client.get('/api/v1/roles').loginAs(admin)
    response.assertStatus(200)

    const roles = response.body() as any[]
    const adminRow = roles.find((r) => r.name === 'admin')
    assert.isDefined(adminRow)
    assert.isAbove(adminRow.usersCount, 0)
    assert.isAbove(adminRow.permissionsCount, 0)
    assert.isAbove(adminRow.modulesCount, 0)
  })

  test('GET /modules returns the module catalog with visibleName', async ({ client, assert }) => {
    const admin = await createAdmin()
    const response = await client.get('/api/v1/modules').loginAs(admin)
    response.assertStatus(200)
    const modules = response.body() as any[]
    assert.lengthOf(modules, MODULE_NAMES.length)
    const courts = modules.find((m) => m.name === 'courts')
    assert.equal(courts.visibleName, 'Canchas')
  })

  /**
   * El OR de `GET /roles` (routes.ts): el listado es del ABM, pero la pantalla de Usuarios lo
   * necesita para llenar los <select> de Rol. Sin esto, dar de alta un usuario sin `roles.view`
   * dejaría el desplegable vacío. Leer NO implica poder escribir.
   */
  test('a worker reaches GET /roles through users.view, without holding roles.view', async ({
    client,
    assert,
  }) => {
    const worker = await createWorker()
    const response = await client.get('/api/v1/roles').loginAs(worker)
    response.assertStatus(200)
    assert.isAbove((response.body() as any[]).length, 0)
  })

  test('that same worker still cannot write anything in the roles ABM', async ({ client }) => {
    const worker = await createWorker()
    const adminRoleId = await findRoleIdByName('admin')

    await client
      .post('/api/v1/roles')
      .loginAs(worker)
      .json({ name: 'inventado', grid: {} })
      .then((r) => r.assertStatus(403))

    await client
      .put(`/api/v1/roles/${adminRoleId}`)
      .loginAs(worker)
      .json({ description: 'no' })
      .then((r) => r.assertStatus(403))

    await client
      .delete(`/api/v1/roles/${adminRoleId}`)
      .loginAs(worker)
      .then((r) => r.assertStatus(403))
  })

  test('the modules catalog stays out of a worker reach — it has no user_permissions.view', async ({
    client,
  }) => {
    const worker = await createWorker()
    const response = await client.get('/api/v1/modules').loginAs(worker)
    response.assertStatus(403)
  })

  test('creating a role with a name already used by a live role is rejected with 409', async ({
    client,
  }) => {
    const admin = await createAdmin()
    const response = await client
      .post('/api/v1/roles')
      .loginAs(admin)
      .json({ name: 'admin', grid: fullGrid() })
    response.assertStatus(409)
  })

  test('deleting a seeded role (e.g. admin) is always rejected with 403, regardless of usersCount', async ({
    client,
  }) => {
    const admin = await createAdmin()
    const adminRoleId = await findRoleIdByName('admin')
    const response = await client.delete(`/api/v1/roles/${adminRoleId}`).loginAs(admin)
    response.assertStatus(403)
  })

  test('deleting a custom role with assigned users is blocked with 409 and the usersCount', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const create = await client
      .post('/api/v1/roles')
      .loginAs(admin)
      .json({ name: 'Kiosco', grid: fullGrid(['courts']) })
    const roleId = (create.body() as any).id

    const worker = await createWorker()
    const assign = await client
      .put(`/api/v1/users/${worker.id}`)
      .loginAs(admin)
      .json({ role: 'Kiosco' })
    assign.assertStatus(200)

    const destroy = await client.delete(`/api/v1/roles/${roleId}`).loginAs(admin)
    destroy.assertStatus(409)
    assert.equal((destroy.body() as any).usersCount, 1)

    // still there, unharmed
    const show = await client.get(`/api/v1/roles/${roleId}`).loginAs(admin)
    show.assertStatus(200)
  })

  test('admin cannot strip roles.view or roles.update from their own role (anti-lockout)', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const adminRoleId = await findRoleIdByName('admin')
    assert.equal(admin.roleId, adminRoleId)

    // grid grants everything EXCEPT `roles` — this must be rejected before any write happens.
    const response = await client
      .put(`/api/v1/roles/${adminRoleId}`)
      .loginAs(admin)
      .json({ grid: fullGrid(MODULE_NAMES.filter((m) => m !== 'roles')) })
    response.assertStatus(403)
  })

  test('admin CAN edit their own role as long as roles.view and roles.update stay true', async ({
    client,
  }) => {
    const admin = await createAdmin()
    const adminRoleId = await findRoleIdByName('admin')

    const response = await client
      .put(`/api/v1/roles/${adminRoleId}`)
      .loginAs(admin)
      .json({ description: 'Admin actualizado', grid: fullGrid(MODULE_NAMES) })
    response.assertStatus(200)
  })
})
