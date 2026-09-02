import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import {
  createCustomer,
  createPadelCourt,
  createProfessor,
  createUserWithPermissions,
  nowART,
  openCashSession,
  setProfessorHours,
  setProfessorPrices,
} from './fixtures.js'

/**
 * A professor's class does not carry a deposit. It is charged whole at the configured
 * professor rate, so the reservation is born with NO advance requirement — whoever books
 * it, and whatever the form sends.
 *
 * The rule is expressed as the ABSENCE of a requirement (both deposit columns null), and
 * that absence is what turns the deposit off everywhere else: the UI keys its "Pagó seña"
 * button on it, and payTotal() stops demanding a deposit before the full payment. So the
 * assertions here are on the two columns, not on any separate flag.
 *
 * Three doors are covered because each one used to be able to reintroduce a deposit on
 * its own: store() (booking), update() (editing) and payDeposit() (charging it directly
 * through the API, which the front end never offers but the route accepts).
 *
 * `createProfessor()` stays a role fixture on purpose: being a professor is the domain
 * fact the pricing branch keys on (`role === 'professor'`), not an access decision. The
 * staff side is built from GRANTS so a Roles ABM tweak cannot break it.
 */
const PROF_START = 8
const PROF_END = 18

const RATE_INDIVIDUAL = 12000
const RATE_GROUP = 15000

/** Books and edits on someone else's behalf; `reservations.update` is the PUT route gate. */
const STAFF_GRANTS = {
  reservations: { view: true, create: true, update: true },
  reservation_management: { view: true, update: true },
}

const CASHIER_GRANTS = {
  reservations: { view: true, create: true, update: true },
  reservation_management: { view: true, update: true },
  payments: { view: true, create: true },
  cash_register: { view: true, create: true },
}

type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

/** Tomorrow 10:00 ART — inside the professor window, and never in the past. */
function allowedSlotISO(): string {
  return nowART().startOf('day').plus({ days: 1 }).set({ hour: 10 }).toISO()!
}

test.group('professor reservations carry no deposit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => setProfessorHours(PROF_START, PROF_END))
  group.each.setup(() => setProfessorPrices({ individual: RATE_INDIVIDUAL, group: RATE_GROUP }))

  test('a professor booking for themselves gets no deposit, even sending one', async ({
    client,
    assert,
  }) => {
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(professor).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      depositPercentage: 30,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.isNull(created.depositPercentage)
    assert.isNull(created.depositFixedAmount)
  })

  test('staff booking FOR a professor gets no deposit either', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
      depositPercentage: 30,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.equal(created.userId, professor.id)
    assert.isNull(created.depositPercentage)
    assert.isNull(created.depositFixedAmount)
  })

  test('a fixed amount is dropped too, not only the percentage', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'grupal',
      customerId: professor.id,
      depositFixedAmount: 5000,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.isNull(created.depositFixedAmount)
    assert.isNull(created.depositPercentage)
    // The class is still charged in full at the configured rate.
    assert.equal(Number(created.totalPrice), RATE_GROUP)
  })

  // Guard against the fix "working" by turning the deposit off for everybody.
  test('a customer reservation keeps its deposit', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
      depositPercentage: 30,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    assert.equal(Number(created.depositPercentage), 30)
  })

  test('editing cannot put a deposit back on a professor reservation', async ({
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
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ depositPercentage: 50 })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.isNull(after.depositPercentage)
    assert.isNull(after.depositFixedAmount)
  })

  test('editing a customer reservation still accepts a deposit', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const customer = await createCustomer()
    const court = await createPadelCourt()

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
      .json({ depositPercentage: 50 })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.equal(Number(after.depositPercentage), 50)
  })
})

/**
 * payDeposit() is the door the front end never opens for these rows — the button is hidden
 * when both columns are null — but the route accepts the call, and it moves money.
 */
test.group('payDeposit rejects a reservation with no deposit requirement', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => setProfessorHours(PROF_START, PROF_END))
  group.each.setup(() => setProfessorPrices({ individual: RATE_INDIVIDUAL, group: RATE_GROUP }))
  // middleware.cashRegister answers 409 to every money movement with the register closed.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('charging a deposit on a professor class is refused', async ({ client, assert }) => {
    const cashier = await createUserWithPermissions(CASHIER_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(cashier).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
    })
    created.assertStatus(201)

    const response = await client
      .patch(`/api/v1/reservations/${idOf(created)}/pay-deposit`)
      .loginAs(cashier)
      .json({ efectivo: 1000 })

    response.assertStatus(400)
    const after = await Reservation.findOrFail(idOf(created))
    assert.isFalse(after.depositPaid)
  })

  test('a reservation that DOES require a deposit still accepts the charge', async ({
    client,
    assert,
  }) => {
    const cashier = await createUserWithPermissions(CASHIER_GRANTS)
    const customer = await createCustomer()
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(cashier).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      customerId: customer.id,
      depositPercentage: 30,
    })
    created.assertStatus(201)

    const response = await client
      .patch(`/api/v1/reservations/${idOf(created)}/pay-deposit`)
      .loginAs(cashier)
      .json({ efectivo: 600 })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.isTrue(after.depositPaid)
  })

  /**
   * The whole point of dropping the deposit is that the class can still be charged: with no
   * advance to wait for, payTotal() must go straight through.
   */
  test('the professor class can be paid in full with no deposit first', async ({
    client,
    assert,
  }) => {
    const cashier = await createUserWithPermissions(CASHIER_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(cashier).json({
      courtId: court.id,
      startTime: allowedSlotISO(),
      duration: 60,
      classType: 'individual',
      customerId: professor.id,
    })
    created.assertStatus(201)

    const response = await client
      .patch(`/api/v1/reservations/${idOf(created)}/pay-total`)
      .loginAs(cashier)
      .json({ efectivo: RATE_INDIVIDUAL })

    response.assertStatus(200)
    const after = await Reservation.findOrFail(idOf(created))
    assert.isTrue(after.totalPaid)
  })
})
