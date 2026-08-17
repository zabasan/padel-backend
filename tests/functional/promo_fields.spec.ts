import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  createStaff,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  setPromoSettings,
} from './fixtures.js'

// Promo fields parity: GET /reservations (index) and GET /reservations/:id (show) must both
// return `isFreeGame` + a zeroed `occurrencePrice` for the free occurrence, via the shared
// `attachPromoFields` extraction (spec: "Cycle boundary marks next occurrence free").
//
// NOTE (disclosed): `attachPromoFields` was already implemented in an earlier apply batch
// (Phase 1/2 refactor, to give `show()` the same hidden-date-aware next-due logic `payTotal`
// needed). This test therefore validates already-implemented behavior rather than driving a
// fresh RED — see apply-progress for the full disclosure. It still exercises real production
// code end-to-end (real HTTP + real DB via transaction), not a local mirror.
test.group('promo fields parity — index and show both return isFreeGame', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /reservations includes isFreeGame=true and occurrencePrice=0 for the free occurrence', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 }) // cycle = 4
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 3 })

    const response = await client.get('/api/v1/reservations').loginAs(staff)
    response.assertStatus(200)

    const body = response.body() as any[]
    const row = body.find((r) => r.id === reservation.id)
    assert.isDefined(row, 'expected the fixture reservation in the index response')
    assert.isTrue(row.isFreeGame)
    assert.equal(Number(row.occurrencePrice), 0)
  })

  test('GET /reservations/:id includes isFreeGame=true and occurrencePrice=0 for the free occurrence', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 })
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 3 })

    const response = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(staff)
    response.assertStatus(200)

    const body = response.body() as any
    assert.isTrue(body.isFreeGame)
    assert.equal(Number(body.occurrencePrice), 0)
  })

  test('a non-boundary occurrence is NOT flagged free and keeps a non-zero occurrencePrice', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    await setPromoSettings({ enabled: true, games: 3, freeGames: 1 })
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 0 })

    const index = await client.get('/api/v1/reservations').loginAs(staff)
    index.assertStatus(200)
    const row = (index.body() as any[]).find((r) => r.id === reservation.id)
    assert.isFalse(row.isFreeGame)
    assert.isAbove(Number(row.occurrencePrice), 0)

    const show = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(staff)
    show.assertStatus(200)
    assert.isFalse((show.body() as any).isFreeGame)
  })
})
