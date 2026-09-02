import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Reservation from '#models/reservation'
import { createPadelCourt, nowART, setDefaultDepositPercentage } from './fixtures.js'

/**
 * The guest form announces "se requiere una seña del X% para confirmar", reading the same
 * `defaultDepositPercentage` setting the counter uses as its default. The row it created
 * carried no deposit at all, so the promise was never kept: nothing could be charged as a
 * deposit, because the whole app decides whether a deposit exists by looking at these two
 * columns.
 *
 * The absence of a requirement is written as null — that is the shape every other reader
 * expects (the "Pagó seña" button, the badge, and payTotal's `hasDepositRequirement`), so a
 * configured 0 must land as null and not as a zero-valued requirement.
 */
const COURT_RATE = 2000

type JsonResponse = { body(): unknown }
const reservationIdOf = (r: JsonResponse) =>
  (r.body() as { reservation: { id: number } }).reservation.id

/** Tomorrow 10:00 ART — never in the past. */
function slotISO(): string {
  return nowART().startOf('day').plus({ days: 1 }).set({ hour: 10 }).toISO()!
}

/** Guests are matched by phone, so each test needs its own to avoid reusing a user. */
let phoneCounter = 0
function uniquePhone(): string {
  phoneCounter += 1
  return `1199${String(phoneCounter).padStart(6, '0')}`
}

test.group('guest reservations carry the configured deposit', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('the configured percentage lands on the reservation', async ({ client, assert }) => {
    await setDefaultDepositPercentage(40)
    const court = await createPadelCourt(COURT_RATE)

    const response = await client.post('/api/v1/guest/reservations').json({
      fullName: 'Invitado Test',
      phone: uniquePhone(),
      courtId: court.id,
      startTime: slotISO(),
      duration: 60,
    })

    response.assertStatus(200)
    const created = await Reservation.findOrFail(reservationIdOf(response))
    assert.equal(Number(created.depositPercentage), 40)
  })

  test('a deposit of 0 is stored as no requirement at all', async ({ client, assert }) => {
    await setDefaultDepositPercentage(0)
    const court = await createPadelCourt(COURT_RATE)

    const response = await client.post('/api/v1/guest/reservations').json({
      fullName: 'Invitado Test',
      phone: uniquePhone(),
      courtId: court.id,
      startTime: slotISO(),
      duration: 60,
    })

    response.assertStatus(200)
    const created = await Reservation.findOrFail(reservationIdOf(response))
    assert.isNull(created.depositPercentage)
    assert.isNull(created.depositFixedAmount)
  })

  test('the reservation is still born unpaid and pending', async ({ client, assert }) => {
    await setDefaultDepositPercentage(30)
    const court = await createPadelCourt(COURT_RATE)

    const response = await client.post('/api/v1/guest/reservations').json({
      fullName: 'Invitado Test',
      phone: uniquePhone(),
      courtId: court.id,
      startTime: slotISO(),
      duration: 60,
    })

    response.assertStatus(200)
    const created = await Reservation.findOrFail(reservationIdOf(response))
    assert.equal(created.status, 'pending')
    assert.isFalse(created.depositPaid)
  })
})
