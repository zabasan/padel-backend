import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import { MIN_BOOKING_MINUTES } from '#services/booking_rules'
import {
  createFootballCourt,
  createPadelCourt,
  createUserWithPermissions,
  nowART,
} from './fixtures.js'

/**
 * The complex does not rent a court for less than an hour. The booking grids stopped
 * offering sub-hour gaps, but the API is what actually decides, and it accepted `30`.
 *
 * Staff were the exposed path: the per-sport duration whitelists further down in
 * `store()` explicitly bypass admins and workers, so the vine floor was the only thing
 * standing between a privileged client and a half-hour reservation. The guest endpoint
 * has no whitelist at all and is public, so it had nothing standing there either.
 */
const STAFF_GRANTS = {
  reservations: { view: true, create: true, update: true },
  reservation_management: { view: true, update: true },
}

/** Tomorrow 10:00 ART — never in the past, so no test depends on the wall clock. */
function slotISO(hour = 10): string {
  return nowART().startOf('day').plus({ days: 1 }).set({ hour }).toISO()!
}

type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

test.group('reservation duration floor', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('the floor is an hour', ({ assert }) => {
    assert.equal(MIN_BOOKING_MINUTES, 60)
  })

  test('staff cannot create a half-hour reservation even though they bypass the whitelists', async ({
    client,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: slotISO(),
      duration: 30,
    })

    response.assertStatus(422)
  })

  test('an hour is accepted', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: slotISO(),
      duration: MIN_BOOKING_MINUTES,
    })

    response.assertStatus(201)
    const created = await Reservation.findOrFail(idOf(response))
    const minutes = Math.round(created.endTime.diff(created.startTime, 'minutes').minutes)
    assert.equal(minutes, MIN_BOOKING_MINUTES)
  })

  test('an edit cannot shrink a reservation below the floor', async ({ client }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createPadelCourt()

    const created = await client.post('/api/v1/reservations').loginAs(staff).json({
      courtId: court.id,
      startTime: slotISO(),
      duration: 90,
    })
    created.assertStatus(201)

    const response = await client
      .put(`/api/v1/reservations/${idOf(created)}`)
      .loginAs(staff)
      .json({ duration: 30 })

    response.assertStatus(422)
  })

  test('the public guest endpoint holds the same floor', async ({ client }) => {
    const court = await createFootballCourt()

    const response = await client.post('/api/v1/guest/reservations').json({
      fullName: 'Fixture Guest',
      phone: '1150000001',
      courtId: court.id,
      startTime: slotISO(11),
      duration: 30,
    })

    response.assertStatus(422)
  })

  test('a duration past the ceiling is rejected too', async ({ client }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const court = await createFootballCourt()

    const response = await client
      .post('/api/v1/reservations')
      .loginAs(staff)
      .json({
        courtId: court.id,
        startTime: slotISO(12),
        duration: 481,
      })

    response.assertStatus(422)
  })
})
