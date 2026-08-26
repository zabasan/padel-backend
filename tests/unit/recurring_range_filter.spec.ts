import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

// ─── Helpers (mirror reservations_controller weekday-range filter) ────────────
// The controller returns recurring series (fijas) regardless of the requested day so the
// frontend can expand them into occurrences. To keep the payload bounded it drops series
// whose ART weekday can't fall in [from, to]. Weekday is resolved in ART, NOT UTC — a
// Friday-22:30 fija is stored as Saturday UTC and must still match a Friday view.

// Mirrors reservations_controller.weekdaysInARTRange
function weekdaysInARTRange(from?: string, to?: string): Set<number> | null {
  if (!from || !to) return null
  const fromDT = DateTime.fromISO(from).setZone(ART_TZ).startOf('day')
  const toDT = DateTime.fromISO(to).setZone(ART_TZ).endOf('day')
  const weekdays = new Set<number>()
  for (let d = fromDT; d <= toDT && weekdays.size < 7; d = d.plus({ days: 1 })) {
    weekdays.add(d.weekday)
  }
  return weekdays
}

interface FakeRow {
  id: number
  isRecurring: boolean
  startTime: DateTime // stored UTC, as Lucid hands it to the controller
}

// Mirrors reservations_controller.filterRecurringByRange
function filterRecurringByRange(rows: FakeRow[], from?: string, to?: string): FakeRow[] {
  const weekdays = weekdaysInARTRange(from, to)
  if (!weekdays) return rows
  return rows.filter((r) => !r.isRecurring || weekdays.has(r.startTime.setZone(ART_TZ).weekday))
}

// ART local time → stored UTC, the way a reservation start_time lives in the DB.
const artUTC = (y: number, mo: number, d: number, h: number, mi = 0) =>
  DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi }, { zone: ART_TZ }).toUTC()

const dayRange = (isoDate: string) => ({
  from: `${isoDate}T00:00:00-03:00`,
  to: `${isoDate}T23:59:59-03:00`,
})

const recurring = (id: number, start: DateTime): FakeRow => ({
  id,
  isRecurring: true,
  startTime: start,
})
const oneOff = (id: number, start: DateTime): FakeRow => ({
  id,
  isRecurring: false,
  startTime: start,
})

// ─── Tests ───────────────────────────────────────────────────────────────────

test.group('weekdaysInARTRange', () => {
  test('a single day yields exactly that ART weekday', ({ assert }) => {
    // 2026-07-01 is a Wednesday (weekday 3) in ART.
    const { from, to } = dayRange('2026-07-01')
    const set = weekdaysInARTRange(from, to)
    assert.deepEqual([...set!], [3])
  })

  test('a full week yields all seven weekdays', ({ assert }) => {
    const set = weekdaysInARTRange('2026-06-29T00:00:00-03:00', '2026-07-05T23:59:59-03:00')
    assert.deepEqual(
      [...set!].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7]
    )
  })

  test('open range (missing bound) returns null → keep everything', ({ assert }) => {
    assert.isNull(weekdaysInARTRange(undefined, '2026-07-01T23:59:59-03:00'))
    assert.isNull(weekdaysInARTRange('2026-07-01T00:00:00-03:00', undefined))
  })
})

test.group('filterRecurringByRange — single day view', () => {
  const { from, to } = dayRange('2026-07-01') // Wednesday

  test('keeps a recurring series whose weekday matches the day', ({ assert }) => {
    const rows = [recurring(1, artUTC(2026, 6, 24, 19))] // a Wednesday 19:00 ART
    assert.deepEqual(
      filterRecurringByRange(rows, from, to).map((r) => r.id),
      [1]
    )
  })

  test('drops a recurring series whose weekday does NOT match the day', ({ assert }) => {
    const rows = [recurring(2, artUTC(2026, 6, 26, 19))] // a Friday 19:00 ART
    assert.deepEqual(filterRecurringByRange(rows, from, to), [])
  })

  test('always keeps non-recurring rows (already date-bounded by SQL)', ({ assert }) => {
    const rows = [oneOff(3, artUTC(2026, 6, 26, 19))] // Friday one-off still passes through
    assert.deepEqual(
      filterRecurringByRange(rows, from, to).map((r) => r.id),
      [3]
    )
  })

  test('mixed set: only the matching recurring + all one-offs survive', ({ assert }) => {
    const rows = [
      recurring(1, artUTC(2026, 6, 24, 19)), // Wed → keep
      recurring(2, artUTC(2026, 6, 26, 19)), // Fri → drop
      oneOff(3, artUTC(2026, 7, 1, 20)), // one-off → keep
    ]
    assert.deepEqual(
      filterRecurringByRange(rows, from, to).map((r) => r.id),
      [1, 3]
    )
  })

  test('an open range keeps recurring rows of any weekday', ({ assert }) => {
    const rows = [recurring(2, artUTC(2026, 6, 26, 19))] // Friday
    assert.deepEqual(
      filterRecurringByRange(rows, undefined, undefined).map((r) => r.id),
      [2]
    )
  })
})

test.group('filterRecurringByRange — week view keeps every weekday', () => {
  test('a Friday fija is kept when viewing a full week', ({ assert }) => {
    const rows = [recurring(2, artUTC(2026, 6, 26, 19))] // Friday
    const kept = filterRecurringByRange(
      rows,
      '2026-06-29T00:00:00-03:00',
      '2026-07-05T23:59:59-03:00'
    )
    assert.deepEqual(
      kept.map((r) => r.id),
      [2]
    )
  })
})

test.group('filterRecurringByRange — timezone edge (late-night Friday)', () => {
  // Friday 22:30 ART is stored as Saturday 01:30 UTC. The filter must match it on a
  // FRIDAY view, not a Saturday view, or the late-night fija would silently disappear.
  const lateFriday = artUTC(2026, 7, 3, 22, 30) // Fri 22:30 ART → Sat 01:30 UTC

  test('stored UTC weekday is Saturday but ART weekday is Friday', ({ assert }) => {
    assert.equal(lateFriday.weekday, 6, 'UTC sees Saturday')
    assert.equal(lateFriday.setZone(ART_TZ).weekday, 5, 'ART sees Friday')
  })

  test('REGRESSION: kept on the Friday view (matching ART weekday)', ({ assert }) => {
    const { from, to } = dayRange('2026-07-03') // Friday
    assert.deepEqual(
      filterRecurringByRange([recurring(9, lateFriday)], from, to).map((r) => r.id),
      [9]
    )
  })

  test('REGRESSION: dropped on the Saturday view (does not leak to UTC weekday)', ({ assert }) => {
    const { from, to } = dayRange('2026-07-04') // Saturday
    assert.deepEqual(filterRecurringByRange([recurring(9, lateFriday)], from, to), [])
  })
})
