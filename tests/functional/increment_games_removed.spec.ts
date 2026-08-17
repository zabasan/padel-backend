import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  createStaff,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
} from './fixtures.js'

// The manual "Jugó" action and its silent auto-increment counterpart are removed entirely —
// the streak is now payment-driven only (spec: "Removed action has no effect").
test.group('increment-games route removed', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('PATCH /reservations/:id/increment-games no longer exists (404) and does not change consecutiveGames', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt()
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 2 })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/increment-games`)
      .loginAs(staff)
      .json({})
    response.assertStatus(404)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 2)
  })
})
