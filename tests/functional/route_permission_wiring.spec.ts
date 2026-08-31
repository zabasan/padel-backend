import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  closeAmbientCashRegister,
  createBareRole,
  createPadelCourt,
  createRecurringReservation,
  createUserWithPermissions,
  todayISODate,
} from './fixtures.js'

/**
 * `permission_matrix.spec.ts` proves the GRANTS are right. This proves the WIRING is right —
 * that the right route actually carries `middleware.permission({module, action})`. Built up
 * module by module so a wiring mistake is caught at its module, not at the end.
 *
 * EVERY test here asserts on a PERMISSION, never on a role name. Which role holds which verb
 * is a business decision the Roles ABM can change at any time; that a given route is gated on
 * a given {module, action} is a code contract. Tying these tests to role names conflated the
 * two, and an admin tightening `worker` through the app turned the suite red with nothing
 * broken. `createUserWithPermissions()` builds a user on a bare role holding exactly the
 * grants under test — see the note on that fixture for why a customer is not a valid baseline.
 *
 * Each gate is proven in both directions: a user granted the verb gets PAST the gate, and a
 * user holding the module's other verbs (or nothing) gets 403. The negative direction is what
 * catches a missing annotation; the positive one is what catches a typo'd module name, which
 * would otherwise 403 everybody and look like a correctly locked route.
 *
 * Statuses beyond the gate are other files' business: assert 403 or `notEqual(403)`, not a
 * specific success code, unless the success path is trivially deterministic.
 */
test.group('route permission wiring — settings', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no settings permission cannot PUT /settings', async ({ client }) => {
    const user = await createUserWithPermissions()
    const response = await client.put('/api/v1/settings').loginAs(user).json({})
    response.assertStatus(403)
  })

  // settings is a view/update module — proves the gate reads `update`, not just
  // "has some settings permission".
  test('settings.view alone does NOT open PUT /settings', async ({ client }) => {
    const viewer = await createUserWithPermissions({ settings: { view: true } })
    const response = await client.put('/api/v1/settings').loginAs(viewer).json({})
    response.assertStatus(403)
  })

  test('a user granted settings.update can PUT /settings', async ({ client }) => {
    const editor = await createUserWithPermissions({ settings: { view: true, update: true } })
    const response = await client.put('/api/v1/settings').loginAs(editor).json({})
    response.assertStatus(200)
  })
})

test.group('route permission wiring — stats', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no stats permission cannot GET /stats', async ({ client }) => {
    const user = await createUserWithPermissions()
    const response = await client.get('/api/v1/stats').loginAs(user)
    response.assertStatus(403)
  })

  test('a user granted stats.view can GET /stats', async ({ client }) => {
    const viewer = await createUserWithPermissions({ stats: { view: true } })
    const response = await client.get('/api/v1/stats').loginAs(viewer)
    response.assertStatus(200)
  })
})

test.group('route permission wiring — audit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no audit permission cannot GET /audit/users', async ({ client }) => {
    const user = await createUserWithPermissions()
    const response = await client.get('/api/v1/audit/users').loginAs(user)
    response.assertStatus(403)
  })

  // All three audit endpoints share one `audit.view` gate — worth covering
  // together, since a typo on any single annotation would only show up here.
  test('a user granted audit.view reaches all three audit endpoints', async ({ client }) => {
    const auditor = await createUserWithPermissions({ audit: { view: true } })

    const users = await client.get('/api/v1/audit/users').loginAs(auditor)
    users.assertStatus(200)

    const reservations = await client.get('/api/v1/audit/reservations').loginAs(auditor)
    reservations.assertStatus(200)

    const commerce = await client.get('/api/v1/audit/commerce').loginAs(auditor)
    commerce.assertStatus(200)
  })
})

test.group('route permission wiring — users', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no users permission is denied on every users route', async ({ client }) => {
    const nobody = await createUserWithPermissions()
    const target = await createUserWithPermissions()

    const responses = await Promise.all([
      client.post('/api/v1/users').loginAs(nobody).json({ fullName: 'X', phone: '5599999001' }),
      client.get('/api/v1/users').loginAs(nobody),
      client.get('/api/v1/users/search?q=abc').loginAs(nobody),
      client.get(`/api/v1/users/${target.id}`).loginAs(nobody),
      client.put(`/api/v1/users/${target.id}`).loginAs(nobody).json({ fullName: 'Y' }),
      client.post(`/api/v1/users/${target.id}/reset-login`).loginAs(nobody),
      client.patch(`/api/v1/users/${target.id}/toggle-status`).loginAs(nobody),
      client.delete(`/api/v1/users/${target.id}`).loginAs(nobody),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  // The target is a zero-grant user, not a customer. `assertCanActOnUser` refuses to
  // let anyone act on a user whose effective permissions are not a subset of their own
  // (users_controller.ts) — a `customer` target holds courts.view + reservations.vcue,
  // so a manager granted only `users.*` would be blocked by THAT rule and the 403 would
  // say nothing about the route's gate. The escalation rule has its own spec file
  // (user_privilege_escalation.spec.ts); keep it out of the wiring proof.
  test('users.view/create/update open their own routes', async ({ client }) => {
    const manager = await createUserWithPermissions({
      users: { view: true, create: true, update: true },
    })
    const target = await createUserWithPermissions()

    // A bare role is assignable by anyone (D7 compares the assigned role's grants
    // against the actor's); the default `customer` is not, and would 403 on that
    // rule instead of on this route's gate. Email is required for any non-customer.
    const assignable = await createBareRole()
    const create = await client.post('/api/v1/users').loginAs(manager).json({
      fullName: 'Nuevo Cliente',
      phone: '5599999002',
      email: 'nuevo.cliente@example.test',
      role: assignable.name,
    })
    create.assertStatus(201)

    const view = await client.get('/api/v1/users').loginAs(manager)
    view.assertStatus(200)

    const search = await client.get('/api/v1/users/search?q=Fixture').loginAs(manager)
    search.assertStatus(200)

    const update = await client
      .put(`/api/v1/users/${target.id}`)
      .loginAs(manager)
      .json({ fullName: 'Editado' })
    update.assertStatus(200)
  })

  // Both destructive routes are gated on `users.erase`, and toggle-status is the
  // easy one to get wrong — it reads as an update but deactivating an account is
  // treated as destructive on purpose.
  test('users.view/create/update do NOT open toggle-status or delete (both need erase)', async ({
    client,
  }) => {
    const manager = await createUserWithPermissions({
      users: { view: true, create: true, update: true },
    })
    const target = await createUserWithPermissions()

    const toggleStatus = await client
      .patch(`/api/v1/users/${target.id}/toggle-status`)
      .loginAs(manager)
    toggleStatus.assertStatus(403)

    const destroy = await client.delete(`/api/v1/users/${target.id}`).loginAs(manager)
    destroy.assertStatus(403)
  })

  test('users.erase opens toggle-status and delete', async ({ client }) => {
    const remover = await createUserWithPermissions({ users: { view: true, erase: true } })
    const target = await createUserWithPermissions()

    const toggleStatus = await client
      .patch(`/api/v1/users/${target.id}/toggle-status`)
      .loginAs(remover)
    toggleStatus.assertStatus(200)

    const destroy = await client.delete(`/api/v1/users/${target.id}`).loginAs(remover)
    destroy.assertStatus(200)
  })
})

test.group('route permission wiring — courts', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // courts.view is deliberately NOT enough to write — GET /courts is a public
  // unannotated route, so a read-only grant must still bounce off every write.
  test('courts.view alone cannot write to courts', async ({ client }) => {
    const viewer = await createUserWithPermissions({ courts: { view: true } })
    const court = await createPadelCourt()

    const create = await client
      .post('/api/v1/courts')
      .loginAs(viewer)
      .json({ name: 'Cancha X', type: 'padel', pricePerHour: 1000 })
    create.assertStatus(403)

    const update = await client
      .put(`/api/v1/courts/${court.id}`)
      .loginAs(viewer)
      .json({ name: 'Y', type: 'padel', pricePerHour: 1000 })
    update.assertStatus(403)

    const destroy = await client.delete(`/api/v1/courts/${court.id}`).loginAs(viewer)
    destroy.assertStatus(403)
  })

  test('a user granted courts.create can create a court', async ({ client }) => {
    const grantee = await createUserWithPermissions({ courts: { view: true, create: true } })
    const create = await client
      .post('/api/v1/courts')
      .loginAs(grantee)
      .json({ name: 'Cancha Nueva', type: 'padel', pricePerHour: 1500 })
    create.assertStatus(201)
  })

  test('a user granted courts.update can update a court', async ({ client }) => {
    const grantee = await createUserWithPermissions({ courts: { view: true, update: true } })
    const court = await createPadelCourt()
    const update = await client
      .put(`/api/v1/courts/${court.id}`)
      .loginAs(grantee)
      .json({ name: 'Renombrada', type: 'padel', pricePerHour: 1500 })
    update.assertStatus(200)
  })

  test('a user granted courts.erase can delete a court', async ({ client }) => {
    const grantee = await createUserWithPermissions({ courts: { view: true, erase: true } })
    const court = await createPadelCourt()
    const destroy = await client.delete(`/api/v1/courts/${court.id}`).loginAs(grantee)
    destroy.assertStatus(200)
  })
})

// These routes' business logic (state preconditions, inline role checks) is exercised by other
// spec files. Here the only thing under test is the permission GATE: a role lacking the
// permission must get 403 before the controller runs at all; a role holding it must get PAST the
// gate (any other status is that route's own business logic, out of scope for this file).
test.group('route permission wiring — reservation_management', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no reservation_management permission is denied on every route', async ({
    client,
  }) => {
    const nobody = await createUserWithPermissions()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, nobody)

    const responses = await Promise.all([
      client
        .patch(`/api/v1/reservations/${reservation.id}/hide-next`)
        .loginAs(nobody)
        .json({ date: todayISODate() }),
      client
        .patch(`/api/v1/reservations/${reservation.id}/show-next`)
        .loginAs(nobody)
        .json({ date: todayISODate() }),
      client.get(`/api/v1/reservations/${reservation.id}/audit`).loginAs(nobody),
      client.patch(`/api/v1/reservations/${reservation.id}/revert`).loginAs(nobody),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  test('reservation_management.view/update pass their gates but do NOT open revert (erase)', async ({
    client,
    assert,
  }) => {
    const grantee = await createUserWithPermissions({
      reservation_management: { view: true, update: true },
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

  test('reservation_management.erase opens revert', async ({ client, assert }) => {
    const grantee = await createUserWithPermissions({
      reservation_management: { view: true, update: true, erase: true },
    })
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, grantee)

    const revert = await client
      .patch(`/api/v1/reservations/${reservation.id}/revert`)
      .loginAs(grantee)
    assert.notEqual(revert.status(), 403)
  })
})

/**
 * Caja: tres verbos y no cuatro. `view` ve el turno y el historial, `create` ABRE,
 * `update` CIERRA. Abrir y cerrar están separados para que se puedan conceder por
 * separado desde el ABM de Roles, así que el gate se prueba en ambas direcciones: quien
 * solo puede abrir NO puede cerrar.
 */
test.group('route permission wiring — cash_register', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // Determinismo: sin esto el resultado de abrir la caja depende de si el complejo la
  // dejó abierta en la app. Ver closeAmbientCashRegister.
  group.each.setup(async () => {
    await closeAmbientCashRegister()
  })

  test('a user holding no cash_register permission cannot read the register', async ({
    client,
  }) => {
    const user = await createUserWithPermissions()
    const current = await client.get('/api/v1/cash-register/current').loginAs(user)
    current.assertStatus(403)
    const sessions = await client.get('/api/v1/cash-register/sessions').loginAs(user)
    sessions.assertStatus(403)
  })

  test('cash_register.view reaches current and sessions', async ({ client }) => {
    const viewer = await createUserWithPermissions({ cash_register: { view: true } })
    const current = await client.get('/api/v1/cash-register/current').loginAs(viewer)
    current.assertStatus(200)
    const sessions = await client.get('/api/v1/cash-register/sessions').loginAs(viewer)
    sessions.assertStatus(200)
  })

  test('cash_register.view alone does NOT open opening or closing', async ({ client }) => {
    const viewer = await createUserWithPermissions({ cash_register: { view: true } })
    const open = await client.post('/api/v1/cash-register/open').loginAs(viewer).json({})
    open.assertStatus(403)
    const close = await client.post('/api/v1/cash-register/close').loginAs(viewer).json({})
    close.assertStatus(403)
  })

  test('cash_register.create opens the register but NOT closing it', async ({ client, assert }) => {
    const opener = await createUserWithPermissions({ cash_register: { create: true } })
    const open = await client.post('/api/v1/cash-register/open').loginAs(opener).json({})
    assert.notEqual(open.status(), 403)

    const close = await client.post('/api/v1/cash-register/close').loginAs(opener).json({})
    close.assertStatus(403)
  })

  test('cash_register.update opens closing', async ({ client, assert }) => {
    const closer = await createUserWithPermissions({ cash_register: { update: true } })
    const close = await client.post('/api/v1/cash-register/close').loginAs(closer).json({})
    assert.notEqual(close.status(), 403)
  })

  // rotate es un cierre Y una apertura: lleva los dos gates stackeados (AND).
  test('rotate needs BOTH update and create', async ({ client, assert }) => {
    const onlyClose = await createUserWithPermissions({ cash_register: { update: true } })
    const denied = await client.post('/api/v1/cash-register/rotate').loginAs(onlyClose).json({})
    denied.assertStatus(403)

    const both = await createUserWithPermissions({
      cash_register: { update: true, create: true },
    })
    const allowed = await client.post('/api/v1/cash-register/rotate').loginAs(both).json({})
    assert.notEqual(allowed.status(), 403)
  })

  // Los fajos van con `update`, el mismo verbo que cerrar: quien arquea el cajón es
  // quien retira los fajos. `view` mira el turno, no lo opera.
  test('cash_register.view alone does NOT open the bundle routes', async ({ client }) => {
    const viewer = await createUserWithPermissions({ cash_register: { view: true } })
    const create = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(viewer)
      .json({ amount: 1000 })
    create.assertStatus(403)
    const cancel = await client
      .post('/api/v1/cash-register/bundles/1/cancel')
      .loginAs(viewer)
      .json({})
    cancel.assertStatus(403)
  })

  // El gate de permiso corre ANTES que el de caja abierta, así que el 409 de "la caja
  // está cerrada" es la prueba de que pasó el 403. Que ese 409 llegue es justo lo que
  // se quiere: sin permiso nunca se llegaría tan lejos.
  test('cash_register.update reaches the bundle routes', async ({ client, assert }) => {
    const cashier = await createUserWithPermissions({ cash_register: { update: true } })
    const create = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(cashier)
      .json({ amount: 1000 })
    assert.notEqual(create.status(), 403)
    const cancel = await client
      .post('/api/v1/cash-register/bundles/1/cancel')
      .loginAs(cashier)
      .json({})
    assert.notEqual(cancel.status(), 403)
  })
})

test.group('route permission wiring — payments', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no payments permission is denied on every payments route', async ({
    client,
  }) => {
    const nobody = await createUserWithPermissions()
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, nobody)

    const responses = await Promise.all([
      client.patch(`/api/v1/reservations/${reservation.id}/pay-deposit`).loginAs(nobody).json({}),
      client.patch(`/api/v1/reservations/${reservation.id}/pay-total`).loginAs(nobody).json({}),
      client.delete(`/api/v1/reservations/${reservation.id}/payments`).loginAs(nobody),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  test('payments.create passes the charging gates but does NOT open reverting (erase)', async ({
    client,
    assert,
  }) => {
    const cashier = await createUserWithPermissions({ payments: { view: true, create: true } })
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, cashier)

    const payDeposit = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-deposit`)
      .loginAs(cashier)
      .json({ efectivo: 1000, transferencia: 0, postnet: 0 })
    assert.notEqual(payDeposit.status(), 403)

    const revertAll = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments`)
      .loginAs(cashier)
    revertAll.assertStatus(403)
  })

  test('payments.erase opens reverting payments', async ({ client, assert }) => {
    const supervisor = await createUserWithPermissions({
      payments: { view: true, create: true, erase: true },
    })
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, supervisor)

    const revertAll = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments`)
      .loginAs(supervisor)
    assert.notEqual(revertAll.status(), 403)
  })
})

// Every SEEDED role holds reservations.vcue, which is why this group used to have no
// denial test at all — there was no role to point at. A zero-grant user gives us one,
// so the gate on these routes is now proven in both directions like every other module.
test.group('route permission wiring — reservations', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a user holding no reservations permission is denied on the reservations routes', async ({
    client,
  }) => {
    const nobody = await createUserWithPermissions()
    const court = await createPadelCourt()

    const start = new Date()
    start.setHours(start.getHours() + 3, 0, 0, 0)

    const responses = await Promise.all([
      client.get('/api/v1/reservations').loginAs(nobody),
      client
        .post('/api/v1/reservations')
        .loginAs(nobody)
        .json({ courtId: court.id, startTime: start.toISOString(), duration: 60 }),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  test('reservations.view opens the listing, and create opens booking', async ({
    client,
    assert,
  }) => {
    const booker = await createUserWithPermissions({
      reservations: { view: true, create: true },
    })
    const court = await createPadelCourt()

    const list = await client.get('/api/v1/reservations').loginAs(booker)
    list.assertStatus(200)

    const start = new Date()
    start.setHours(start.getHours() + 3, 0, 0, 0)

    const create = await client.post('/api/v1/reservations').loginAs(booker).json({
      courtId: court.id,
      startTime: start.toISOString(),
      duration: 60,
    })
    assert.notEqual(create.status(), 403)
  })

  // The notes-only PATCH is gated on `reservations.update`, same as the full PUT. Both users
  // below hold `reservation_management.view` so the controller's own staff/ownership guard is
  // satisfied either way — what changes between them is only the verb under test.
  test('reservations.update opens the notes-only PATCH', async ({ client, assert }) => {
    const grantee = await createUserWithPermissions({
      reservations: { view: true, update: true },
      reservation_management: { view: true },
    })
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, grantee)

    const patch = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(grantee)
      .json({ notes: 'una nota' })
    assert.notEqual(patch.status(), 403)
  })

  test('reservations.view alone does NOT open the notes-only PATCH', async ({ client }) => {
    const viewer = await createUserWithPermissions({
      reservations: { view: true },
      reservation_management: { view: true },
    })
    const court = await createPadelCourt()
    const reservation = await createRecurringReservation(court, viewer)

    const patch = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(viewer)
      .json({ notes: 'una nota' })
    patch.assertStatus(403)
  })
})
