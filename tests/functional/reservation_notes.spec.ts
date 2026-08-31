import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import ReservationAuditLog from '#models/reservation_audit_log'
import { createPadelCourt, createUserWithPermissions, nowART } from './fixtures.js'
import type Court from '#models/court'
import type User from '#models/user'

/**
 * `PATCH /reservations/:id/notes` exists so the counter can fix an annotation from the
 * reservation detail view without opening the full edit form.
 *
 * It is NOT the full `PUT /reservations/:id` with one field. That path recalculates
 * `totalPrice` from the price ranges in force TODAY and refuses to touch a reservation that
 * already happened — both wrong for editing a line of text. Those two properties are what
 * the tests below pin down; everything else here is the plumbing around them.
 */
const STAFF_GRANTS = {
  reservations: { view: true, update: true },
  reservation_management: { view: true },
}

/**
 * A plain (non-recurring) reservation. `totalPrice` is set independently of the court's price
 * ranges on purpose, so a recalculation would be visible as a changed number.
 */
function createPlainReservation(
  court: Court,
  user: User,
  opts: { notes?: string | null; hoursFromNow?: number; totalPrice?: number } = {}
): Promise<Reservation> {
  const startTime = nowART()
    .startOf('hour')
    .plus({ hours: opts.hoursFromNow ?? 3 })
  return Reservation.create({
    courtId: court.id,
    userId: user.id,
    startTime,
    endTime: startTime.plus({ minutes: 60 }),
    totalPrice: opts.totalPrice ?? 777,
    status: 'confirmed',
    isRecurring: false,
    depositPaid: false,
    totalPaid: false,
    discountPercentage: 0,
    consecutiveGames: 0,
    notes: opts.notes ?? null,
  })
}

test.group('reservation notes — notes-only edit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a PATCH replaces the note', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, staff, { notes: 'abono mensual' })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: 'abono mensual — paga los martes' })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.notes, 'abono mensual — paga los martes')
  })

  test('a note can be added to a reservation that had none', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, staff, { notes: null })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: 'trae sus propias paletas' })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.notes, 'trae sus propias paletas')
  })

  // Blank clears the column instead of storing '' — "no note" has one representation.
  test('an empty note clears the column', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, staff, { notes: 'algo' })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: '   ' })
    response.assertStatus(200)

    await reservation.refresh()
    assert.isNull(reservation.notes)
  })

  test('the change is audit-logged once, with both values', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, staff, { notes: 'vieja' })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: 'nueva' })
    response.assertStatus(200)

    const logs = await ReservationAuditLog.query()
      .where('reservation_id', reservation.id)
      .where('field', 'notes')
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].oldValue, 'vieja')
    assert.equal(logs[0].newValue, 'nueva')
    assert.equal(logs[0].performedBy, staff.id)
  })

  test('a PATCH that changes nothing writes no audit row', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, staff, { notes: 'igual' })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: 'igual' })
    response.assertStatus(200)

    const logs = await ReservationAuditLog.query()
      .where('reservation_id', reservation.id)
      .where('field', 'notes')
    assert.lengthOf(logs, 0)
  })

  /**
   * THE reason this endpoint is not `PUT` with one field. The stored price (777) does not match
   * what this court's ranges would produce (2000), which is the state of any reservation booked
   * before its court was repriced. Editing a note must not move that number.
   */
  test('the price is left alone', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt(2000)
    const reservation = await createPlainReservation(court, staff, { totalPrice: 777 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: 'sin tocar el precio' })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(Number(reservation.totalPrice), 777)
  })

  /**
   * The other reason. `update()` rejects a past non-recurring reservation for anyone but a
   * superuser — and annotating a reservation that already happened is exactly the use case.
   */
  test('a past reservation still accepts a note', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, staff, { hoursFromNow: -5 })

    const patch = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(staff)
      .json({ notes: 'quedó debiendo la mitad' })
    patch.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.notes, 'quedó debiendo la mitad')

    // Contrast: the full edit path is what refuses this, and still does.
    const put = await client
      .put(`/api/v1/reservations/${reservation.id}`)
      .loginAs(staff)
      .json({ notes: 'por el form completo' })
    put.assertStatus(400)
  })

  test('a non-staff user cannot annotate someone else’s reservation', async ({ client }) => {
    const owner = await createUserWithPermissions(STAFF_GRANTS)
    const outsider = await createUserWithPermissions({ reservations: { view: true, update: true } })
    const court = await createPadelCourt()
    const reservation = await createPlainReservation(court, owner)

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/notes`)
      .loginAs(outsider)
      .json({ notes: 'no debería entrar' })
    response.assertStatus(403)
  })
})
