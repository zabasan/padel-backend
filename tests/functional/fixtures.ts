// Shared fixture builders for the functional suite. NOT a *.spec.ts file, so Japa's
// `tests/functional/**/*.spec.{ts,js}` glob never picks it up as a standalone test.
//
// IMPORTANT: `.env.test` points at the real dev database (no isolated test DB exists for
// this project). Every functional test group MUST wrap each test in a rolled-back global
// transaction via `group.each.setup(() => testUtils.db().withGlobalTransaction())` so
// nothing written here ever survives past the test. Never rely on committed fixtures.
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import User from '#models/user'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import CourtPriceHistory from '#models/court_price_history'
import Reservation from '#models/reservation'
import Setting from '#models/setting'

const ART_TZ = 'America/Argentina/Buenos_Aires'

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}-${Math.round(Math.random() * 1e6)}`
}

export async function createWorker(): Promise<User> {
  return User.create({
    fullName: 'Fixture Worker',
    email: `${unique('fixture-worker')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'worker',
  })
}

export async function createCustomer(): Promise<User> {
  return User.create({
    fullName: 'Fixture Customer',
    email: `${unique('fixture-customer')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'customer',
  })
}

// Padel court with a single all-day price range so calcRecurringOccurrencePrice has a
// deterministic, hour-independent price to work with.
export async function createPadelCourt(pricePerHour = 2000): Promise<Court> {
  const court = await Court.create({
    name: unique('Fixture Padel Court'),
    type: 'padel',
    description: 'Fixture court for functional tests',
    pricePerHour,
    isActive: true,
  })
  await CourtPriceRange.create({
    courtId: court.id,
    startHour: 0,
    endHour: 24,
    pricePerHour,
    isPeakHour: false,
    price60Min: pricePerHour,
    price90Min: Math.round(pricePerHour * 1.5),
    price120Min: pricePerHour * 2,
  })
  return court
}

// Writes one all-day price batch into `court_price_history`, effective from `effectiveFrom`.
// Call it once per price change so `getHistoricalRanges` has distinct batches to choose from and
// a test can prove which occurrence date a price was resolved against.
export async function addCourtPriceHistory(
  court: Court,
  pricePerHour: number,
  effectiveFrom: DateTime
): Promise<void> {
  await CourtPriceHistory.create({
    courtId: court.id,
    effectiveFrom,
    startHour: 0,
    endHour: 24,
    pricePerHour,
    isPeakHour: false,
    price60Min: pricePerHour,
    price90Min: Math.round(pricePerHour * 1.5),
    price120Min: pricePerHour * 2,
  })
}

// Sets/overwrites the recurring-promo settings rows (upsert, safe inside a rolled-back tx).
export async function setPromoSettings(opts: { enabled: boolean; games: number; freeGames: number }): Promise<void> {
  await Setting.updateOrCreate({ key: 'recurringPromoEnabled' }, { key: 'recurringPromoEnabled', value: String(opts.enabled) })
  await Setting.updateOrCreate({ key: 'recurringPromoGames' }, { key: 'recurringPromoGames', value: String(opts.games) })
  await Setting.updateOrCreate({ key: 'recurringPromoFreeGames' }, { key: 'recurringPromoFreeGames', value: String(opts.freeGames) })
}

// Today's date/time in ART, used as the deterministic anchor for "next occurrence" math.
export function nowART(): DateTime {
  return DateTime.now().setZone(ART_TZ)
}

// Builds a weekly recurring reservation whose weekday matches "today" (ART), so
// `nextOccurrenceDate`/`nextDueOccurrence` resolve the pending occurrence to `todayISODate()`
// when called with `now`. `weeksAgo` anchors the series' original `startTime` in the past
// (purely cosmetic unless a test also sets `lastIncrementedAt`/hidden dates further back).
export async function createRecurringReservation(
  court: Court,
  targetUser: User,
  opts: {
    hour?: number
    weeksAgo?: number
    consecutiveGames?: number
    lastIncrementedWeeksAgo?: number | null
    depositPercentage?: number | null
    depositFixedAmount?: number | null
    depositPaid?: boolean
    totalPrice?: number
    discountPercentage?: number
    customPrice?: number | null
  } = {}
): Promise<Reservation> {
  const hour = opts.hour ?? 10
  const weeksAgo = opts.weeksAgo ?? 8
  const today = nowART().startOf('day').set({ hour })
  const startTime = today.minus({ weeks: weeksAgo })
  const endTime = startTime.plus({ minutes: 60 })

  const lastIncrementedAt =
    opts.lastIncrementedWeeksAgo != null ? today.minus({ weeks: opts.lastIncrementedWeeksAgo }) : null

  return Reservation.create({
    courtId: court.id,
    userId: targetUser.id,
    startTime,
    endTime,
    totalPrice: opts.totalPrice ?? 2000,
    status: 'confirmed',
    isRecurring: true,
    depositPercentage: opts.depositPercentage ?? null,
    depositFixedAmount: opts.depositFixedAmount ?? null,
    depositPaid: opts.depositPaid ?? false,
    totalPaid: false,
    discountPercentage: opts.discountPercentage ?? 0,
    consecutiveGames: opts.consecutiveGames ?? 0,
    lastIncrementedAt,
    customPrice: opts.customPrice ?? null,
  })
}

export function todayISODate(): string {
  return nowART().toISODate()!
}

export function weeksAgoISODate(weeks: number): string {
  return nowART()
    .startOf('day')
    .minus({ weeks })
    .toISODate()!
}

export function weeksAheadISODate(weeks: number): string {
  return nowART()
    .startOf('day')
    .plus({ weeks })
    .toISODate()!
}
