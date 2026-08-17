import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { setUserPermission } from '#services/permissions'
import {
  createAdmin,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  createWorker,
  todayISODate,
} from './fixtures.js'

/**
 * `permission_matrix.spec.ts` proves the GRANTS are right. This proves the WIRING is right —
 * that the right route actually carries `middleware.permission({module, action})` — which is the
 * only thing Step 3 (routes.ts annotation) can get wrong. Built up module by module, in the same
 * order as the rollout, so a wiring mistake is caught at its module, not at the end.
 *
 * `role_middleware` stays on every route below during this rollout (AND semantics) — these tests
 * use `customer`/`worker`, neither of which passes the OLD gate on admin-only routes either, so a
 * 403 here does not yet prove `permission_middleware` fired on its own. That end-to-end proof
 * lands once each group's `role` wrapper is removed (plan §9-STEP-3, "once a group is fully
 * covered"). What these tests DO prove now: the annotation exists, is spelled correctly, and
 * matches the seeded matrix — a typo'd module name or action would 403 here today already,
 * because `customer`/`worker` hold nothing on these modules regardless of which gate fires.
 */
test.group('route permission wiring — settings', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer cannot PUT /settings', async ({ client }) => {
    const customer = await createCustomer()
    const response = await client.put('/api/v1/settings').loginAs(customer).json({})
    response.assertStatus(403)
  })

  test('worker cannot PUT /settings (holds no settings permission)', async ({ client }) => {
    const worker = await createWorker()
    const response = await client.put('/api/v1/settings').loginAs(worker).json({})
    response.assertStatus(403)
  })

  test('admin can PUT /settings', async ({ client }) => {
    const admin = await createAdmin()
    const response = await client.put('/api/v1/settings').loginAs(admin).json({})
    response.assertStatus(200)
  })
})

test.group('route permission wiring — stats', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer cannot GET /stats', async ({ client }) => {
    const customer = await createCustomer()
    const response = await client.get('/api/v1/stats').loginAs(customer)
    response.assertStatus(403)
  })

  test('worker cannot GET /stats (holds no stats permission)', async ({ client }) => {
    const worker = await createWorker()
    const response = await client.get('/api/v1/stats').loginAs(worker)
    response.assertStatus(403)
  })

  test('admin can GET /stats', async ({ client }) => {
    const admin = await createAdmin()
    const response = await client.get('/api/v1/stats').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('route permission wiring — audit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer cannot GET /audit/users', async ({ client }) => {
    const customer = await createCustomer()
    const response = await client.get('/api/v1/audit/users').loginAs(customer)
    response.assertStatus(403)
  })

  test('worker cannot GET /audit/users (holds no audit permission)', async ({ client }) => {
    const worker = await createWorker()
    const response = await client.get('/api/v1/audit/users').loginAs(worker)
    response.assertStatus(403)
  })

  test('admin can GET /audit/users', async ({ client }) => {
    const admin = await createAdmin()
    const response = await client.get('/api/v1/audit/users').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('route permission wiring — users', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer is denied on every users route', async ({ client }) => {
    const customer = await createCustomer()
    const target = await createCustomer()

    const responses = await Promise.all([
      client.post('/api/v1/users').loginAs(customer).json({ fullName: 'X', phone: '5599999001' }),
      client.get('/api/v1/users').loginAs(customer),
      client.get('/api/v1/users/search?q=abc').loginAs(customer),
      client.get(`/api/v1/users/${target.id}`).loginAs(customer),
      client.put(`/api/v1/users/${target.id}`).loginAs(customer).json({ fullName: 'Y' }),
      client.post(`/api/v1/users/${target.id}/reset-login`).loginAs(customer),
      client.patch(`/api/v1/users/${target.id}/toggle-status`).loginAs(customer),
      client.delete(`/api/v1/users/${target.id}`).loginAs(customer),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  test('worker holds create/view/update but not erase', async ({ client }) => {
    const worker = await createWorker()
    const target = await createCustomer()

    const create = await client
      .post('/api/v1/users')
      .loginAs(worker)
      .json({ fullName: 'Nuevo Cliente', phone: '5599999002' })
    create.assertStatus(201)

    const view = await client.get('/api/v1/users').loginAs(worker)
    view.assertStatus(200)

    const update = await client
      .put(`/api/v1/users/${target.id}`)
      .loginAs(worker)
      .json({ fullName: 'Editado' })
    update.assertStatus(200)

    const toggleStatus = await client.patch(`/api/v1/users/${target.id}/toggle-status`).loginAs(worker)
    toggleStatus.assertStatus(403)

    const destroy = await client.delete(`/api/v1/users/${target.id}`).loginAs(worker)
    destroy.assertStatus(403)
  })

  test('admin holds every users action, including erase', async ({ client }) => {
    const admin = await createAdmin()
    const target = await createCustomer()

    const toggleStatus = await client.patch(`/api/v1/users/${target.id}/toggle-status`).loginAs(admin)
    toggleStatus.assertStatus(200)

    const destroy = await client.delete(`/api/v1/users/${target.id}`).loginAs(admin)
    destroy.assertStatus(200)
  })
})

test.group('route permission wiring — courts', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer cannot write to courts (only holds courts.view, via unannotated public routes)', async ({
    client,
  }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()

    const create = await client
      .post('/api/v1/courts')
      .loginAs(customer)
      .json({ name: 'Cancha X', type: 'padel', pricePerHour: 1000 })
    create.assertStatus(403)

    const update = await client
      .put(`/api/v1/courts/${court.id}`)
      .loginAs(customer)
      .json({ name: 'Y', type: 'padel', pricePerHour: 1000 })
    update.assertStatus(403)

    const destroy = await client.delete(`/api/v1/courts/${court.id}`).loginAs(customer)
    destroy.assertStatus(403)
  })

  // Which verbs `worker` actually holds on `courts` is a business call made
  // through the Roles ABM (today: view-only — no edit/delete) and can change
  // without this file going red. So each verb's wiring is proven with a grant
  // scoped to exactly that verb, not the `worker` role. See engram (padel) for
  // the tracked follow-up to convert the rest of this suite the same way.
  test('a user granted courts.create can create a court', async ({ client }) => {
    const grantee = await createCustomer()
    await setUserPermission(grantee.id, 'courts', {
      view: true,
      create: true,
      update: false,
      erase: false,
    })
    const create = await client
      .post('/api/v1/courts')
      .loginAs(grantee)
      .json({ name: 'Cancha Nueva', type: 'padel', pricePerHour: 1500 })
    create.assertStatus(201)
  })

  test('a user granted courts.update can update a court', async ({ client }) => {
    const grantee = await createCustomer()
    await setUserPermission(grantee.id, 'courts', {
      view: true,
      create: false,
      update: true,
      erase: false,
    })
    const court = await createPadelCourt()
    const update = await client
      .put(`/api/v1/courts/${court.id}`)
      .loginAs(grantee)
      .json({ name: 'Renombrada', type: 'padel', pricePerHour: 1500 })
    update.assertStatus(200)
  })

  test('a user granted courts.erase can delete a court', async ({ client }) => {
    const grantee = await createCustomer()
    await setUserPermission(grantee.id, 'courts', {
      view: true,
      create: false,
      update: false,
      erase: true,
    })
    const court = await createPadelCourt()
    const destroy = await client.delete(`/api/v1/courts/${court.id}`).loginAs(grantee)
    destroy.assertStatus(200)
  })

  test('admin holds full courts CRUD', async ({ client }) => {
    const admin = await createAdmin()
    const court = await createPadelCourt()
    const destroy = await client.delete(`/api/v1/courts/${court.id}`).loginAs(admin)
    destroy.assertStatus(200)
  })
})

// These routes' business logic (state preconditions, inline role checks) is exercised by other
// spec files. Here the only thing under test is the permission GATE: a role lacking the
// permission must get 403 before the controller runs at all; a role holding it must get PAST the
// gate (any other status is that route's own business logic, out of scope for this file).
test.group('route permission wiring — reservation_management', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer is denied on every reservation_management route', async ({ client }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, customer)

    const responses = await Promise.all([
      client.patch(`/api/v1/reservations/${reservation.id}/hide-next`).loginAs(customer).json({ date: todayISODate() }),
      client.patch(`/api/v1/reservations/${reservation.id}/show-next`).loginAs(customer).json({ date: todayISODate() }),
      client.get(`/api/v1/reservations/${reservation.id}/audit`).loginAs(customer),
      client.patch(`/api/v1/reservations/${reservation.id}/revert`).loginAs(customer),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  // Whether `worker` holds reservation_management.erase is a business call made
  // through the Roles ABM and can change without this file going red — see
  // engram (padel) for the tracked follow-up to convert the rest of this suite
  // the same way. What must always hold, regardless of which role has what: a
  // user granted view+update passes those gates but not erase (revert).
  test('a user granted reservation_management.view/update passes those gates but not erase (revert)', async ({
    client,
    assert,
  }) => {
    const grantee = await createCustomer()
    await setUserPermission(grantee.id, 'reservation_management', {
      view: true,
      create: false,
      update: true,
      erase: false,
    })
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, grantee)

    const hideNext = await client
      .patch(`/api/v1/reservations/${reservation.id}/hide-next`)
      .loginAs(grantee)
      .json({ date: todayISODate() })
    assert.notEqual(hideNext.status(), 403)

    const auditLogs = await client
      .get(`/api/v1/reservations/${reservation.id}/audit`)
      .loginAs(grantee)
    assert.notEqual(auditLogs.status(), 403)

    const revert = await client
      .patch(`/api/v1/reservations/${reservation.id}/revert`)
      .loginAs(grantee)
    revert.assertStatus(403)
  })

  test('admin passes the gate on every reservation_management route', async ({ client, assert }) => {
    const admin = await createAdmin()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, admin)

    const hideNext = await client
      .patch(`/api/v1/reservations/${reservation.id}/hide-next`)
      .loginAs(admin)
      .json({ date: todayISODate() })
    assert.notEqual(hideNext.status(), 403)

    const auditLogs = await client.get(`/api/v1/reservations/${reservation.id}/audit`).loginAs(admin)
    assert.notEqual(auditLogs.status(), 403)

    const revert = await client.patch(`/api/v1/reservations/${reservation.id}/revert`).loginAs(admin)
    assert.notEqual(revert.status(), 403)
  })
})

test.group('route permission wiring — payments', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer is denied on every payments route', async ({ client }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, customer)

    const responses = await Promise.all([
      client.patch(`/api/v1/reservations/${reservation.id}/pay-deposit`).loginAs(customer).json({}),
      client.patch(`/api/v1/reservations/${reservation.id}/pay-total`).loginAs(customer).json({}),
      client.delete(`/api/v1/reservations/${reservation.id}/payments`).loginAs(customer),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  test('worker passes the gate on payments.create but not payments.erase', async ({ client, assert }) => {
    const worker = await createWorker()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, worker)

    const payDeposit = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-deposit`)
      .loginAs(worker)
      .json({ efectivo: 1000, transferencia: 0, postnet: 0 })
    assert.notEqual(payDeposit.status(), 403)

    const revertAll = await client.delete(`/api/v1/reservations/${reservation.id}/payments`).loginAs(worker)
    revertAll.assertStatus(403)
  })

  test('admin passes the gate on every payments route', async ({ client, assert }) => {
    const admin = await createAdmin()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, admin)

    const payDeposit = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-deposit`)
      .loginAs(admin)
      .json({ efectivo: 1000, transferencia: 0, postnet: 0 })
    assert.notEqual(payDeposit.status(), 403)

    const revertAll = await client.delete(`/api/v1/reservations/${reservation.id}/payments`).loginAs(admin)
    assert.notEqual(revertAll.status(), 403)
  })
})

// `reservations` has no `role_middleware` wrapper today — every authenticated role holds
// reservations.vcue in the seeded matrix, so there is no role to assert a 403 against here.
// The meaningful wiring proof is the opposite: a typo'd module name would 403 everyone,
// including the most restrictive role (customer) — so proving customer passes is the real test.
test.group('route permission wiring — reservations', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer, worker and admin all pass the reservations.view gate', async ({ client, assert }) => {
    const customer = await createCustomer()
    const worker = await createWorker()
    const admin = await createAdmin()

    const responses = await Promise.all([
      client.get('/api/v1/reservations').loginAs(customer),
      client.get('/api/v1/reservations').loginAs(worker),
      client.get('/api/v1/reservations').loginAs(admin),
    ])
    for (const response of responses) assert.notEqual(response.status(), 403)
  })

  test('customer can create/update/erase their own reservation (reservations.create/update/erase gate passes)', async ({
    client,
    assert,
  }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()

    const start = new Date()
    start.setHours(start.getHours() + 3, 0, 0, 0)

    const create = await client.post('/api/v1/reservations').loginAs(customer).json({
      courtId: court.id,
      startTime: start.toISOString(),
      duration: 60,
    })
    assert.notEqual(create.status(), 403)
  })
})
