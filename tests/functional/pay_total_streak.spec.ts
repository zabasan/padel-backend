import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import ReservationPayment from '#models/reservation_payment'
import {
  addCourtPriceHistory,
  createStaff,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  nowART,
  setPromoSettings,
  todayISODate,
  weeksAgoISODate,
  weeksAheadISODate,
  openCashSession,
} from './fixtures.js'

// Payment-driven loyalty streak: `consecutiveGames` MUST advance exactly once when the
// TOTAL payment for an occurrence is registered, and MUST NOT advance through any other
// action (spec: "Payment-Driven Streak Increment", "Free Game Registered at Zero Cost").
test.group('payTotal — streak advances on total payment', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => { await openCashSession() })

  test('total payment advances consecutiveGames by exactly one', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 1)
  })

  test('repeating pay-total for the same occurrence is rejected and does not double-advance', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    const first = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    first.assertStatus(200)

    const second = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    second.assertStatus(400)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 1)

    const payments = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'total')
    assert.lengthOf(payments, 1)
  })

  test('deposit-only payment does not advance the streak', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 0,
      depositPercentage: 20,
    })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-deposit`)
      .loginAs(staff)
      .json({ efectivo: 400 })
    response.assertStatus(200)

    await reservation.refresh()
    assert.isTrue(reservation.depositPaid)
    assert.equal(reservation.consecutiveGames, 0)
  })

  test('free occurrence accepts a $0 total payment, records expectedAmount=0, and resets the cycle', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 }) // cycle = 4
    // consecutiveGames == games + freeGames - 1 (3) → next occurrence is the free game
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 3 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 0 })
    response.assertStatus(200)

    await reservation.refresh()
    // 3 + 1 = 4 == cycle → auto-reset to 0
    assert.equal(reservation.consecutiveGames, 0)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'total')
      .firstOrFail()
    assert.equal(Number(payment.total), 0)
    assert.equal(Number(payment.expectedAmount), 0)
  })

  test('free occurrence paid at $0 leaves the series carry balance unaffected', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 })
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 3 })

    const pay = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 0 })
    pay.assertStatus(200)

    const show = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(staff)
    show.assertStatus(200)
    assert.equal(Number(show.body().carryBalance), 0)
  })
})

// A caller looking at one expanded occurrence sends `occurrence_date` so the payment lands on THAT
// week. Without it, `payTotal` resolved the next due occurrence from "today", which charged a past
// occurrence to the upcoming week (and froze that week's `expectedAmount` instead of the paid one).
test.group('payTotal — charges the requested occurrence', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => { await openCashSession() })

  test('occurrence_date charges that past week instead of the next due one', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })
    const pastOccurrence = weeksAgoISODate(1)

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: pastOccurrence })
    response.assertStatus(200)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'total')
      .firstOrFail()
    assert.equal(payment.occurrenceDate, pastOccurrence)
    assert.notEqual(payment.occurrenceDate, todayISODate())
  })

  test('omitting occurrence_date still charges the next due occurrence', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    response.assertStatus(200)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'total')
      .firstOrFail()
    assert.equal(payment.occurrenceDate, todayISODate())
  })

  test('expectedAmount freezes the price effective on the occurrence paid, not on today', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    // Price rose to 9000 two days ago: the occurrence a week back is still worth 2000.
    await addCourtPriceHistory(court, 2000, nowART().minus({ weeks: 10 }))
    await addCourtPriceHistory(court, 9000, nowART().minus({ days: 2 }))

    const past = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: weeksAgoISODate(1) })
    past.assertStatus(200)

    const current = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 9000, occurrence_date: todayISODate() })
    current.assertStatus(200)

    const pastPayment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('occurrence_date', weeksAgoISODate(1))
      .firstOrFail()
    const currentPayment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('occurrence_date', todayISODate())
      .firstOrFail()

    assert.equal(Number(pastPayment.expectedAmount), 2000)
    assert.equal(Number(currentPayment.expectedAmount), 9000)
  })

  test('repeating the same occurrence_date is rejected, a different one is accepted', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })
    const pastOccurrence = weeksAgoISODate(1)

    const first = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: pastOccurrence })
    first.assertStatus(200)

    const repeat = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: pastOccurrence })
    repeat.assertStatus(400)

    const otherWeek = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: weeksAgoISODate(2) })
    otherWeek.assertStatus(200)

    const payments = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'total')
    assert.lengthOf(payments, 2)
  })

  test('paying a late occurrence advances the streak without rewinding lastIncrementedAt', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    // Anchor already sits at today's occurrence; paying two weeks back must not move it backwards,
    // or effectiveConsecutiveGames would re-count hidden dates the streak already consumed.
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 2,
      lastIncrementedWeeksAgo: 0,
    })
    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: weeksAgoISODate(2) })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 3)
    assert.equal(reservation.lastIncrementedAt!.toISODate(), todayISODate())
  })

  test('an occurrence_date that is not a real occurrence of the series is rejected', async ({
    client,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    // Series starts 8 weeks ago on today's weekday.
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })
    await ReservationHiddenDate.create({
      reservationId: reservation.id,
      hiddenDate: weeksAgoISODate(1),
    })

    const wrongWeekday = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: nowART().plus({ days: 1 }).toISODate() })
    wrongWeekday.assertStatus(400)

    const beforeSeriesStart = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: weeksAgoISODate(9) })
    beforeSeriesStart.assertStatus(400)

    const hidden = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: weeksAgoISODate(1) })
    hidden.assertStatus(400)

    const unparseable = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: 'not-a-date' })
    unparseable.assertStatus(400)
  })

  test('a future occurrence can still be paid in advance', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })
    const futureOccurrence = weeksAheadISODate(1)

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000, occurrence_date: futureOccurrence })
    response.assertStatus(200)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'total')
      .firstOrFail()
    assert.equal(payment.occurrenceDate, futureOccurrence)
  })
})
