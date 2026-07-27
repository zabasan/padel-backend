import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ReservationPayment from '#models/reservation_payment'
import {
  createWorker,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  setPromoSettings,
} from './fixtures.js'

// Payment-driven loyalty streak: `consecutiveGames` MUST advance exactly once when the
// TOTAL payment for an occurrence is registered, and MUST NOT advance through any other
// action (spec: "Payment-Driven Streak Increment", "Free Game Registered at Zero Cost").
test.group('payTotal — streak advances on total payment', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('total payment advances consecutiveGames by exactly one', async ({ client, assert }) => {
    const worker = await createWorker()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(worker)
      .json({ efectivo: 2000 })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 1)
  })

  test('repeating pay-total for the same occurrence is rejected and does not double-advance', async ({
    client,
    assert,
  }) => {
    const worker = await createWorker()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    const first = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(worker)
      .json({ efectivo: 2000 })
    first.assertStatus(200)

    const second = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(worker)
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
    const worker = await createWorker()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 0,
      depositPercentage: 20,
    })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-deposit`)
      .loginAs(worker)
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
    const worker = await createWorker()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 }) // cycle = 4
    // consecutiveGames == games + freeGames - 1 (3) → next occurrence is the free game
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 3 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(worker)
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

  test('free occurrence paid at $0 leaves the series carry balance unaffected', async ({ client, assert }) => {
    const worker = await createWorker()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 })
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 3 })

    const pay = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(worker)
      .json({ efectivo: 0 })
    pay.assertStatus(200)

    const show = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(worker)
    show.assertStatus(200)
    assert.equal(Number(show.body().carryBalance), 0)
  })
})
