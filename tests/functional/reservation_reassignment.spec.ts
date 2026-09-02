import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import {
  createCustomer,
  createFootballCourt,
  createPadelCourt,
  createProfessor,
  createUserWithPermissions,
  nowART,
  setProfessorHours,
  setProfessorPrices,
} from './fixtures.js'

/**
 * update() used to resolve the reservation's owner from `reservation.userId` — the owner it
 * HAD — while applying `data.customerId` further down. So a PUT that reassigned a reservation
 * priced it, and set its deposit, against the wrong person: moving one to a professor left it
 * at the court rate with a deposit attached, and moving one away from a professor kept
 * charging the class rate.
 *
 * Both now resolve against the owner the reservation WILL have.
 *
 * Two guards ride along, because the fix would be unsafe without them:
 *
 * - Reassigning is staff-only, mirroring store() (`isAdminOrWorker && data.customerId`).
 *   update() applied it to anyone who reached the handler, and a professor reaches it to edit
 *   their own rows — so a professor could put their reservation in someone else's name.
 * - A professor reservation stays padel-only, mirroring restriction 1 of store(). The class
 *   rate is per hour of class and does not model a football court, so the combination is a
 *   wrong price, not a more flexible booking.
 */
const PROF_START = 8
const PROF_END = 18

const RATE_INDIVIDUAL = 12000
const RATE_GROUP = 15000

const COURT_RATE = 2000

const STAFF_GRANTS = {
  reservations: { view: true, create: true, update: true },
  reservation_management: { view: true, update: true },
}

type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

/** Tomorrow 10:00 ART — inside the professor window, and never in the past. */
function allowedSlotISO(): string {
  return nowART().startOf('day').plus({ days: 1 }).set({ hour: 10 }).toISO()!
}

test.group('update() resolves price and deposit against the NEW owner', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => setProfessorHours(PROF_START, PROF_END))
  group.each.setup(() => setProfessorPrices({ individual: RATE_INDIVIDUAL, group: RATE_GROUP }))

  test('reassigning to a professor reprices at the class rate', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const professor = await createProfessor()
    const court = await createPadelCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
    })
    created.assertStatus(201)
    const before = await Reservation.findOrFail(idOf(created))
    assert.equal(Number(before.totalPrice), COURT_RATE)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ customerId: professor.id, classType: 'individual' })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.userId, professor.id)
    assert.equal(Number(after.totalPrice), RATE_INDIVIDUAL)
  })

  test('reassigning to a professor also clears the deposit', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const professor = await createProfessor()
    const court = await createPadelCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
      depositPercentage: 30,
    })
    created.assertStatus(201)
    const before = await Reservation.findOrFail(idOf(created))
    assert.equal(Number(before.depositPercentage), 30)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ customerId: professor.id, classType: 'individual' })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.isNull(after.depositPercentage)
    assert.isNull(after.depositFixedAmount)
  })

  test('reassigning AWAY from a professor reprices at the court rate', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const customer = await createCustomer()
    const court = await createPadelCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: professor.id,
      classType: 'individual',
    })
    created.assertStatus(201)
    const before = await Reservation.findOrFail(idOf(created))
    assert.equal(Number(before.totalPrice), RATE_INDIVIDUAL)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ customerId: customer.id })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.userId, customer.id)
    assert.equal(Number(after.totalPrice), COURT_RATE)
  })

  test('a reservation that is not reassigned keeps its owner', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const court = await createPadelCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ notes: 'sin reasignar' })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.userId, customer.id)
  })

  test('reassigning to a professor on a FOOTBALL court is refused', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const professor = await createProfessor()
    const court = await createFootballCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ customerId: professor.id })

    response.assertStatus(400)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.userId, customer.id)
    assert.equal(Number(after.totalPrice), COURT_RATE)
  })

  test('moving a professor class onto a FOOTBALL court is refused', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const padel = await createPadelCourt(COURT_RATE)
    const football = await createFootballCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: padel.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: professor.id,
      classType: 'individual',
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ courtId: football.id })

    response.assertStatus(400)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.courtId, padel.id)
  })
})

test.group('reassigning a reservation is staff-only', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => setProfessorHours(PROF_START, PROF_END))
  group.each.setup(() => setProfessorPrices({ individual: RATE_INDIVIDUAL, group: RATE_GROUP }))

  /**
   * A professor reaches update() to edit their own pending rows, and the reassignment was
   * applied without checking who was asking — so this PUT used to hand the reservation over.
   */
  test('a professor cannot put their own reservation in someone else name', async ({
    client,
    assert,
  }) => {
    const professor = await createProfessor()
    const other = await createCustomer()
    const court = await createPadelCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(professor).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(professor)
      .json({ customerId: other.id })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.userId, professor.id)
  })

  test('staff CAN reassign, so the guard did not freeze the counter', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const other = await createCustomer()
    const court = await createPadelCourt(COURT_RATE)

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ customerId: other.id })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(after.userId, other.id)
  })
})
