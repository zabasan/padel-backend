import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import {
  createPadelCourt,
  createProfessor,
  createUserWithPermissions,
  nowART,
  setProfessorHours,
  setProfessorPrices,
} from './fixtures.js'

/**
 * The manual price (`customPrice`) used to be granted by ROLE: the store() gate fired on
 * `isProfessor || targetIsProfessor || isAdminOrWorker`, so a professor booking his own
 * class could name any amount and skip the configured class rate entirely.
 *
 * It is now a counter tool and nothing else — gated by `reservation_management` on both
 * store() and update(). Staff keeps it, INCLUDING when booking for a professor; the
 * professor booking for himself is always charged the configured rate.
 *
 * Two invariants are asserted separately on purpose, because the old code satisfied the
 * first while breaking the second: `totalPrice` must ignore an unauthorized amount, AND
 * the `customPrice` column must not be written. A stale value in that column freezes the
 * per-occurrence price recalculation for recurring series (calcRecurringOccurrencePrice),
 * so persisting a rejected price is a real bug, not cosmetic.
 *
 * `createProfessor()` stays a role fixture: like the padel-only rule, being a professor is
 * the domain fact the pricing branch keys on (`role === 'professor'`), not an access
 * decision. The staff side is built from GRANTS so a Roles ABM tweak cannot break it.
 */
const PROF_START = 8
const PROF_END = 18

const RATE_INDIVIDUAL = 12000
const RATE_GROUP = 15000

/**
 * Enough to book and edit on someone else's behalf. `reservation_management` is what carries
 * the manual-price authority in the controller; `reservations.update` is only the route gate
 * on PUT (routes.ts:73), so both are needed to exercise the edit path.
 */
const STAFF_GRANTS = {
  reservations: { view: true, create: true, update: true },
  reservation_management: { view: true, update: true },
}

// House idiom (see expenses.spec.ts): the client's response body is loosely typed.
type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

/** Tomorrow 10:00 ART — inside the professor window, and never in the past. */
function allowedSlotISO(): string {
  return nowART().startOf('day').plus({ days: 1 }).set({ hour: 10 }).toISO()!
}

test.group('customPrice authority — professor vs staff', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => setProfessorHours(PROF_START, PROF_END))
  group.each.setup(() => setProfessorPrices({ individual: RATE_INDIVIDUAL, group: RATE_GROUP }))

  test('professor booking for themselves cannot set a manual price', async ({ client, assert }) => {
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(professor).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customPrice: 1,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.equal(Number(created.totalPrice), RATE_INDIVIDUAL)
    assert.isNull(created.customPrice)
  })

  test('the configured group rate also survives a manual price from a professor', async ({
    client,
    assert,
  }) => {
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(professor).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'grupal',
      customPrice: 1,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.equal(Number(created.totalPrice), RATE_GROUP)
    assert.isNull(created.customPrice)
  })

  test('staff CAN set a manual price on a reservation for a professor', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
      customPrice: 7777,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.equal(created.userId, professor.id)
    assert.equal(Number(created.totalPrice), 7777)
    assert.equal(Number(created.customPrice), 7777)
  })

  /**
   * update() is the half the front end cannot cover: a professor never reaches the edit
   * modal (it needs `reservation_management.update`), but the API lets him PUT his own
   * rows, so the guard has to live here.
   */
  test('a professor editing their own reservation cannot overwrite the staff-set price', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
      customPrice: 7777,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(professor)
      .json({ customPrice: 1 })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(Number(after.customPrice), 7777)
    assert.equal(Number(after.totalPrice), 7777)
  })

  test('a professor cannot clear the staff-set price either', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
      customPrice: 7777,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(professor)
      .json({ customPrice: null })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(Number(after.customPrice), 7777)
    assert.equal(Number(after.totalPrice), 7777)
  })

  // The staff path through update() must keep working both ways, or the guard above would
  // have "fixed" the professor case by freezing the price for everyone.
  test('staff CAN clear the manual price, which reprices to the configured rate', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
      customPrice: 7777,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ customPrice: null })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.isNull(after.customPrice)
    assert.equal(Number(after.totalPrice), RATE_INDIVIDUAL)
  })
})
