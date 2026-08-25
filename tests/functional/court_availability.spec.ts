import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { type DateTime } from 'luxon'
import Reservation from '#models/reservation'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import type Court from '#models/court'
import type User from '#models/user'
import { createCustomer, createFootballCourt, createPadelCourt, nowART } from './fixtures.js'

/**
 * `GET /courts/availability` feeds every booking grid in the front. It used to filter on
 * `court_id` alone, which made a divisible field lie: with the whole pitch booked, each
 * half still rendered as free, and the caller only hit the wall at store() time — which
 * has always rejected the overlap with a 409.
 *
 * These tests pin the read side against the same rule the write side enforces: parent and
 * children block each other, siblings never do.
 */

/** Tomorrow at `hour` ART — never in the past, so no test depends on the wall clock. */
function slotAt(hour: number, daysAhead = 1): DateTime {
  return nowART().startOf('day').plus({ days: daysAhead }).set({ hour })
}

async function book(
  court: Court,
  user: User,
  at: DateTime,
  opts: { isRecurring?: boolean } = {}
): Promise<Reservation> {
  return Reservation.create({
    courtId: court.id,
    userId: user.id,
    startTime: at,
    endTime: at.plus({ minutes: 60 }),
    totalPrice: 5000,
    status: 'confirmed',
    isRecurring: opts.isRecurring ?? false,
    depositPaid: false,
    totalPaid: false,
    discountPercentage: 0,
    consecutiveGames: 0,
  })
}

/** The three football courts of the real complex: one whole pitch split into two halves. */
async function createDivisibleField() {
  const parent = await createFootballCourt(10000)
  const childA = await createFootballCourt(5000, { parentCourtId: parent.id })
  const childB = await createFootballCourt(5000, { parentCourtId: parent.id })
  return { parent, childA, childB }
}

function availability(client: any, courtId: number, date: string) {
  return client.get('/api/v1/courts/availability').qs({ court_id: courtId, date })
}

test.group('courts availability — parent/child blocking', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('booking the whole field marks the slot taken on each half', async ({ client, assert }) => {
    const { parent, childA, childB } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(10)

    const reservation = await book(parent, customer, at)

    for (const child of [childA, childB]) {
      const response = await availability(client, child.id, at.toISODate()!)
      response.assertStatus(200)
      assert.include(
        (response.body() as any[]).map((r) => r.id),
        reservation.id,
        `la reserva de la cancha completa debe bloquear a ${child.name}`
      )
    }
  })

  test('booking one half marks the slot taken on the whole field', async ({ client, assert }) => {
    const { parent, childA } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(11)

    const reservation = await book(childA, customer, at)

    const response = await availability(client, parent.id, at.toISODate()!)
    response.assertStatus(200)
    assert.include(
      (response.body() as any[]).map((r) => r.id),
      reservation.id
    )
  })

  test('siblings do not block each other', async ({ client, assert }) => {
    const { childA, childB } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(12)

    await book(childA, customer, at)

    const response = await availability(client, childB.id, at.toISODate()!)
    response.assertStatus(200)
    assert.isEmpty(response.body(), 'las dos mitades se alquilan en paralelo')
  })

  test('a recurring booking on the whole field blocks its half on the same weekday only', async ({
    client,
    assert,
  }) => {
    const { parent, childA } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(13)

    const series = await book(parent, customer, at, { isRecurring: true })

    const sameWeekday = await availability(client, childA.id, at.toISODate()!)
    sameWeekday.assertStatus(200)
    assert.include(
      (sameWeekday.body() as any[]).map((r) => r.id),
      series.id
    )

    const nextDay = await availability(client, childA.id, at.plus({ days: 1 }).toISODate()!)
    nextDay.assertStatus(200)
    assert.isEmpty(nextDay.body(), 'la fija sólo ocupa su día de semana')
  })

  test('a hidden occurrence of a recurring booking frees the related court that day', async ({
    client,
    assert,
  }) => {
    const { parent, childA } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(14)

    const series = await book(parent, customer, at, { isRecurring: true })
    const hiddenDate = at.plus({ weeks: 1 }).toISODate()!
    await ReservationHiddenDate.create({ reservationId: series.id, hiddenDate })

    const hidden = await availability(client, childA.id, hiddenDate)
    hidden.assertStatus(200)
    assert.isEmpty(hidden.body(), 'la ocurrencia oculta no ocupa la cancha relacionada')

    const stillBooked = await availability(client, childA.id, at.toISODate()!)
    stillBooked.assertStatus(200)
    assert.include(
      (stillBooked.body() as any[]).map((r) => r.id),
      series.id
    )
  })

  test('a cancelled booking on the whole field does not block its half', async ({
    client,
    assert,
  }) => {
    const { parent, childA } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(15)

    const reservation = await book(parent, customer, at)
    reservation.status = 'cancelled'
    await reservation.save()

    const response = await availability(client, childA.id, at.toISODate()!)
    response.assertStatus(200)
    assert.isEmpty(response.body())
  })

  test('related-court rows carry only the time span, never the other booking details', async ({
    client,
    assert,
  }) => {
    const { parent, childA } = await createDivisibleField()
    const customer = await createCustomer()
    const at = slotAt(16)

    await book(parent, customer, at)

    const response = await availability(client, childA.id, at.toISODate()!)
    response.assertStatus(200)
    const [row] = response.body() as any[]
    assert.deepEqual(Object.keys(row).sort(), [
      'courtId',
      'endTime',
      'id',
      'isRecurring',
      'startTime',
      'status',
    ])
  })

  test('a court with no parent or children answers with its own bookings only', async ({
    client,
    assert,
  }) => {
    const court = await createPadelCourt()
    const customer = await createCustomer()
    const at = slotAt(17)

    const reservation = await book(court, customer, at)

    const response = await availability(client, court.id, at.toISODate()!)
    response.assertStatus(200)
    assert.lengthOf(response.body(), 1)
    assert.equal((response.body() as any[])[0].id, reservation.id)
  })

  test('an unknown court is a 404, not an empty (all-free) grid', async ({ client }) => {
    const response = await availability(client, 99999999, slotAt(18).toISODate()!)
    response.assertStatus(404)
  })
})
