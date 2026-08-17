import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import {
  createStaff,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  todayISODate,
  weeksAheadISODate,
} from './fixtures.js'

// Reset-on-hide: hiding the immediate next-due occurrence (hidden-date-aware) resets the
// streak to 0; hiding a farther-future occurrence must not touch it (spec: "Reset Streak
// Only on Next-Due Hide").
test.group('hideNext — reset only on next-due hide', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('hiding the immediate next-due occurrence resets consecutiveGames to 0', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt()
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 5 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/hide-next`)
      .loginAs(staff)
      .json({ date: todayISODate() })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 0)
    assert.isNull(reservation.lastIncrementedAt)
  })

  test('hiding a farther-future occurrence does not reset consecutiveGames', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt()
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 5 })

    // 3 weeks out — nowhere near the immediate next-due occurrence (today).
    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/hide-next`)
      .loginAs(staff)
      .json({ date: weeksAheadISODate(3) })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 5)
  })

  test('next-due determination skips an already-hidden occurrence before checking the reset match', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt()
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 5 })

    // Today's occurrence is ALREADY hidden (pre-existing), so the true next-due occurrence
    // is next week, not today. Without hidden-date-awareness, naive "next occurrence" logic
    // would still report today, and hiding next week would incorrectly NOT reset.
    await ReservationHiddenDate.create({
      reservationId: reservation.id,
      hiddenDate: todayISODate(),
    })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/hide-next`)
      .loginAs(staff)
      .json({ date: weeksAheadISODate(1) })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 0)
    assert.isNull(reservation.lastIncrementedAt)
  })
})
