import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import type Court from '#models/court'
import type User from '#models/user'
import { DateTime } from 'luxon'
import { createCustomer, createPadelCourt, createRecurringReservation, nowART } from './fixtures.js'

const ART_TZ = 'America/Argentina/Buenos_Aires'

/**
 * `GET /reservations/next` — the customer dashboard's "tu próxima reserva".
 *
 * It exists because neither existing shape answers the question: `summary=true` returns
 * only `{id, status}`, and the paginated listing sorts pending → confirmed → cancelled and
 * then by start_time DESC, so the nearest upcoming row is neither first nor necessarily on
 * page one.
 *
 * The two cases it has to unify are a plain reservation (its own `startTime`) and a
 * recurring series (the next PLAYABLE occurrence, hidden dates skipped) — both answered
 * with the same field names so the caller renders one card either way.
 */
type JsonResponse = { body(): unknown }
type NextBody = { reservation: { id: number; startTime: string; status: string } | null }
const nextOf = (r: JsonResponse) => (r.body() as NextBody).reservation

/**
 * A one-off reservation at an exact instant, written straight to the table.
 *
 * `.toUTC()` is NOT cosmetic. Lucid stores a DateTime as its own wall clock, in whatever
 * zone the object carries, and reads it back labelled UTC. The test runner runs with
 * `TZ=UTC`, so handing it an ART-zoned DateTime (which is what `nowART()` returns) stores
 * "16:00" for what was 16:00 ART and reads it back as 16:00 UTC — the instant slides three
 * hours into the past, and a reservation set 90 minutes from now comes back already over.
 *
 * The app does not hit this: `store()` builds its DateTime with `DateTime.fromISO(...)`,
 * which lands in the system zone. Converting to UTC here reproduces that.
 */
async function createReservationAt(
  court: Court,
  owner: User,
  at: DateTime,
  opts: { status?: 'pending' | 'confirmed' | 'cancelled'; durationMin?: number } = {}
): Promise<Reservation> {
  const durationMin = opts.durationMin ?? 60
  return Reservation.create({
    courtId: court.id,
    userId: owner.id,
    startTime: at.toUTC(),
    endTime: at.plus({ minutes: durationMin }).toUTC(),
    status: opts.status ?? 'confirmed',
    totalPrice: 2000,
    isRecurring: false,
  })
}

test.group('GET /reservations/next', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('returns the NEAREST upcoming reservation, not the farthest', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const soon = await createReservationAt(court, customer, nowART().plus({ days: 2 }))
    await createReservationAt(court, customer, nowART().plus({ days: 9 }))

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.equal(nextOf(response)?.id, soon.id)
  })

  test('a reservation that already ended is not the next one', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    await createReservationAt(court, customer, nowART().minus({ days: 3 }))
    const upcoming = await createReservationAt(court, customer, nowART().plus({ days: 5 }))

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.equal(nextOf(response)?.id, upcoming.id)
  })

  test('a cancelled reservation is never the next one', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    await createReservationAt(court, customer, nowART().plus({ days: 1 }), { status: 'cancelled' })
    const upcoming = await createReservationAt(court, customer, nowART().plus({ days: 4 }))

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.equal(nextOf(response)?.id, upcoming.id)
  })

  test('a pending reservation counts, same as a confirmed one', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const pending = await createReservationAt(court, customer, nowART().plus({ days: 1 }), {
      status: 'pending',
    })

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.equal(nextOf(response)?.id, pending.id)
    assert.equal(nextOf(response)?.status, 'pending')
  })

  test('someone else reservation is never returned', async ({ client, assert }) => {
    const customer = await createCustomer()
    const other = await createCustomer()
    const court = await createPadelCourt()
    await createReservationAt(court, other, nowART().plus({ days: 1 }))

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.isNull(nextOf(response))
  })

  test('no upcoming reservation answers null, not an error', async ({ client, assert }) => {
    const customer = await createCustomer()

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.isNull(nextOf(response))
  })

  /**
   * A fija's `startTime` is weeks in the past — reading it directly would report a date that
   * already happened, which is exactly what this endpoint exists to avoid.
   */
  test('a recurring series resolves to a FUTURE occurrence', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const series = await createRecurringReservation(court, customer, { weeksAgo: 8, hour: 10 })
    assert.isBelow(series.startTime.toMillis(), nowART().toMillis())

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    const next = nextOf(response)
    assert.equal(next?.id, series.id)
    assert.isAbove(DateTime.fromISO(next!.startTime).toMillis(), nowART().toMillis())
  })

  test('the resolved occurrence falls on the series weekday', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const series = await createRecurringReservation(court, customer, { weeksAgo: 8, hour: 10 })

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    const resolved = DateTime.fromISO(nextOf(response)!.startTime).setZone(ART_TZ)
    assert.equal(resolved.weekday, series.startTime.setZone(ART_TZ).weekday)
  })

  test('a hidden occurrence is skipped for the following week', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    const series = await createRecurringReservation(court, customer, { weeksAgo: 8, hour: 10 })

    const before = await client.get('/api/v1/reservations/next').loginAs(customer)
    const firstOccurrence = DateTime.fromISO(nextOf(before)!.startTime)

    // `hidden_date` is a string column of ISO dates, and the controller compares it against
    // the ART date of the occurrence — so the date has to be read in ART, not in the
    // runner's UTC.
    await ReservationHiddenDate.create({
      reservationId: series.id,
      hiddenDate: firstOccurrence.setZone(ART_TZ).toISODate()!,
    })

    const after = await client.get('/api/v1/reservations/next').loginAs(customer)
    after.assertStatus(200)
    const secondOccurrence = DateTime.fromISO(nextOf(after)!.startTime)
    assert.equal(Math.round(secondOccurrence.diff(firstOccurrence, 'days').days), 7)
  })

  /** A plain reservation before the fija's next turn still wins. */
  test('a nearer one-off beats the recurring occurrence', async ({ client, assert }) => {
    const customer = await createCustomer()
    const court = await createPadelCourt()
    await createRecurringReservation(court, customer, { weeksAgo: 8, hour: 10 })
    const soon = await createReservationAt(court, customer, nowART().plus({ minutes: 90 }))

    const response = await client.get('/api/v1/reservations/next').loginAs(customer)

    response.assertStatus(200)
    assert.equal(nextOf(response)?.id, soon.id)
  })
})
