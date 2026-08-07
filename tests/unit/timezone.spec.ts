import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { calculateCourtPrice } from '#services/court_pricing'

const ART_TZ = 'America/Argentina/Buenos_Aires'

// ─── Helpers (mirrors controllers) ───────────────────────────────────────────

function timeInMinutes(dt: DateTime): number {
  const art = dt.setZone(ART_TZ)
  return art.hour * 60 + art.minute
}

interface PriceRange {
  startHour: number
  endHour: number
  price60Min?: number | null
  price90Min?: number | null
  price120Min?: number | null
  pricePerHour: number
}

// These exercise the real production pricing service — do NOT reimplement it here.
// A local copy is what let the midnight bugs survive a green suite.
function calculatePadelPrice(ranges: PriceRange[], defaultPrice: number, start: DateTime, mins: number): number {
  return calculateCourtPrice(
    { type: 'padel', pricePerHour: defaultPrice },
    ranges,
    start,
    start.plus({ minutes: mins })
  )
}

function calculateFootballPrice(ranges: PriceRange[], defaultPrice: number, start: DateTime, end: DateTime): number {
  return calculateCourtPrice({ type: 'football', pricePerHour: defaultPrice }, ranges, start, end)
}

function applyDiscount(price: number, pct: number | null): number {
  if (!pct || pct <= 0) return price
  return Math.round(price * (1 - pct / 100) * 100) / 100
}

function isWeekend(dt: DateTime): boolean {
  return dt.setZone(ART_TZ).weekday >= 6
}

interface FakeReservation {
  startTime: DateTime
  endTime: DateTime
  hiddenDates?: string[]
}

function hasRecurringConflict(reservations: FakeReservation[], startTime: DateTime, endTime: DateTime): boolean {
  const startART = startTime.setZone(ART_TZ)
  const endART   = endTime.setZone(ART_TZ)
  const startWD  = startART.weekday
  const startMin = timeInMinutes(startTime)
  const endMin   = (endART.hour === 0 && endART.minute === 0) ? 24 * 60 : timeInMinutes(endTime)
  const startISO = startART.toISODate()!

  for (const r of reservations) {
    const rStartART = r.startTime.setZone(ART_TZ)
    const rEndART   = r.endTime.setZone(ART_TZ)
    if (rStartART.weekday !== startWD) continue
    if (startISO < rStartART.toISODate()!) continue
    const rMin  = timeInMinutes(r.startTime)
    const rEMin = (rEndART.hour === 0 && rEndART.minute === 0) ? 24 * 60 : timeInMinutes(r.endTime)
    if (startMin >= rEMin || endMin <= rMin) continue
    if ((r.hiddenDates ?? []).includes(startISO)) continue
    return true
  }
  return false
}

function statsDateRange(period: string, date: string) {
  const now = DateTime.now().setZone(ART_TZ)
  let from: DateTime, to: DateTime
  if (period === 'day') {
    const d = date ? DateTime.fromISO(date, { zone: ART_TZ }) : now
    from = d.startOf('day'); to = d.endOf('day')
  } else if (period === 'month') {
    const d = date ? DateTime.fromFormat(date, 'yyyy-MM', { zone: ART_TZ }) : now
    from = d.startOf('month'); to = d.endOf('month')
  } else {
    const y = date ? parseInt(date) : now.year
    from = DateTime.fromObject({ year: y, month: 1,  day: 1  }, { zone: ART_TZ }).startOf('day')
    to   = DateTime.fromObject({ year: y, month: 12, day: 31 }, { zone: ART_TZ }).endOf('day')
  }
  return { fromSQL: from.toUTC().toSQL()!, toSQL: to.toUTC().toSQL()! }
}

function availabilityWindow(dateStr: string) {
  const d = DateTime.fromISO(dateStr, { zone: ART_TZ })
  return {
    weekday:  d.weekday,
    dateIso:  d.toISODate()!,
    startSQL: d.startOf('day').toUTC().toSQL()!,
    endSQL:   d.endOf('day').toUTC().toSQL()!,
  }
}

function nextOccurrenceWeekday(resStartUTC: DateTime, fromNowUTC: DateTime): string {
  const wd = resStartUTC.setZone(ART_TZ).weekday
  let next = fromNowUTC.setZone(ART_TZ).startOf('day').plus({ days: 1 })
  while (next.weekday !== wd) next = next.plus({ days: 1 })
  return next.toISODate()!
}

function thisWeeksOccurrence(resStartUTC: DateTime, nowUTC: DateTime): DateTime {
  const now    = nowUTC.setZone(ART_TZ)
  const res    = resStartUTC.setZone(ART_TZ)
  let occ = now.set({ hour: res.hour, minute: res.minute, second: 0, millisecond: 0 })
  occ = occ.minus({ days: ((now.weekday - res.weekday + 7) % 7) })
  if (occ > now) occ = occ.minus({ weeks: 1 })
  return occ
}

function professorHoursOk(startUTC: DateTime, endUTC: DateTime, profStart: number, profEnd: number): boolean {
  const s = startUTC.setZone(ART_TZ)
  const e = endUTC.setZone(ART_TZ)
  return (s.hour + s.minute / 60) >= profStart && (e.hour + e.minute / 60) <= profEnd
}

// inART (mirrors NewReservationModal.jsx using Luxon)
function inART(iso: string) {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ART_TZ)
  return {
    hours:     dt.hour,
    minutes:   dt.minute,
    dateStr:   dt.toISODate()!,
    dayOfWeek: dt.weekday % 7,
  }
}

function computeOccupiedRanges(reservations: { id: number; status: string; startTime: string; endTime: string }[], excludeId: number | null = null) {
  return reservations
    .filter(r => r.status !== 'cancelled' && (excludeId == null || r.id !== excludeId))
    .map(r => {
      const s = inART(r.startTime)
      const e = inART(r.endTime)
      const sMin = s.hours * 60 + s.minutes
      let eMin   = e.hours * 60 + e.minutes
      if (s.dateStr !== e.dateStr) eMin += 24 * 60
      return [sMin, eMin] as [number, number]
    })
}

function buildDateTime(dateStr: string, slot: string): string {
  if (slot === '00:00') {
    const next = DateTime.fromISO(dateStr, { zone: ART_TZ }).plus({ days: 1 })
    return `${next.toISODate()}T00:00:00-03:00`
  }
  return `${dateStr}T${slot}:00-03:00`
}

function expandRecurringForDate(reservation: { id: number; startTime: string; endTime: string; hiddenDates: string[] }, targetDateStr: string) {
  const base      = inART(reservation.startTime)
  const baseEnd   = inART(reservation.endTime)
  const targetDay = inART(targetDateStr + 'T12:00:00-03:00').dayOfWeek
  if (base.dayOfWeek !== targetDay) return null
  if (reservation.hiddenDates.includes(targetDateStr)) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    ...reservation,
    id: `${reservation.id}-${targetDateStr}`,
    startTime: `${targetDateStr}T${pad(base.hours)}:${pad(base.minutes)}:00.000-03:00`,
    endTime:   `${targetDateStr}T${pad(baseEnd.hours)}:${pad(baseEnd.minutes)}:00.000-03:00`,
  }
}

function getNextOccurrenceDate(startISO: string, hiddenDates: string[] = []): string {
  const targetDay = inART(startISO).dayOfWeek
  const hidden    = new Set(hiddenDates)
  let next = DateTime.now().setZone(ART_TZ).startOf('day').plus({ days: 1 })
  while (next.weekday % 7 !== targetDay) next = next.plus({ days: 1 })
  while (hidden.has(next.toISODate()!)) next = next.plus({ weeks: 1 })
  return next.toISODate()!
}

// ─── Test data ────────────────────────────────────────────────────────────────

const padelRanges: PriceRange[] = [
  { startHour: 8,  endHour: 20, price60Min: 22000, price90Min: 33000, price120Min: 44000, pricePerHour: 22000 },
  { startHour: 20, endHour: 24, price60Min: 27000, price90Min: 40500, price120Min: 54000, pricePerHour: 27000 },
]

const footballRanges: PriceRange[] = [
  { startHour: 8,  endHour: 22, pricePerHour: 22000 },
  { startHour: 22, endHour: 24, pricePerHour: 30000 },
]

const art = (y: number, mo: number, d: number, h: number, mi = 0) =>
  DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi }, { zone: ART_TZ })
const artUTC = (y: number, mo: number, d: number, h: number, mi = 0) =>
  art(y, mo, d, h, mi).toUTC()

// ─── Tests ────────────────────────────────────────────────────────────────────

test.group('Timezone — Core Luxon conversion', () => {
  test('toUTC() of 22:30-03:00 gives hour=1 (what UTC server sees without fix)', ({ assert }) => {
    const asUTC = DateTime.fromISO('2026-06-05T22:30:00-03:00').toUTC()
    assert.equal(asUTC.hour, 1)
  })

  test('setZone(ART_TZ) recovers hour=22 from UTC-normalised DateTime', ({ assert }) => {
    const asUTC = DateTime.fromISO('2026-06-05T22:30:00-03:00').toUTC()
    assert.equal(asUTC.setZone(ART_TZ).hour, 22)
  })

  test('fromISO with setZone:true preserves hour=22', ({ assert }) => {
    const dt = DateTime.fromISO('2026-06-05T22:30:00-03:00', { setZone: true })
    assert.equal(dt.hour, 22)
  })

  test('ART offset is -180 min (UTC-3)', ({ assert }) => {
    assert.equal(art(2026, 6, 5, 10).offset, -180)
  })
})

test.group('Timezone — calculatePadelPrice', () => {
  test('22:30 ART (=01:30 UTC) 90min → evening range 40500', ({ assert }) => {
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 22, 30), 90), 40500)
  })

  test('22:30 ART 60min → 27000', ({ assert }) => {
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 22, 30), 60), 27000)
  })

  test('22:30 ART 120min → 54000', ({ assert }) => {
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 22, 30), 120), 54000)
  })

  test('10:00 ART 60/90/120min → daytime prices', ({ assert }) => {
    const start = artUTC(2026, 6, 5, 10)
    assert.equal(calculatePadelPrice(padelRanges, 22000, start, 60),  22000)
    assert.equal(calculatePadelPrice(padelRanges, 22000, start, 90),  33000)
    assert.equal(calculatePadelPrice(padelRanges, 22000, start, 120), 44000)
  })

  test('23:30 ART (crosses UTC midnight) 60min → evening range 27000', ({ assert }) => {
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 23, 30), 60), 27000)
  })

  test('no ranges → defaultPrice × duration', ({ assert }) => {
    assert.equal(calculatePadelPrice([], 20000, artUTC(2026, 6, 5, 10), 90), 30000)
  })

  test('exactly 20:00 ART → starts evening range', ({ assert }) => {
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 20), 60), 27000)
  })

  test('19:59 ART 60min crosses into evening → charges the pricier range', ({ assert }) => {
    // 19:59-20:59 starts daytime (22000) but finishes in the evening range (27000)
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 19, 59), 60), 27000)
  })

  test('ending exactly on the boundary stays in the starting range', ({ assert }) => {
    // 19:00-20:00 touches 20:00 but never plays inside the evening range
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 19), 60), 22000)
  })

  test('90min straddling 20:00 → evening price, not daytime', ({ assert }) => {
    // 19:00-20:30 → max(daytime 33000, evening 40500)
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 19), 90), 40500)
  })

  test('23:00 ART 120min runs past midnight → evening price, never 0', ({ assert }) => {
    // 23:00-01:00: no range covers 01:00, so the starting range prices the whole booking
    assert.equal(calculatePadelPrice(padelRanges, 22000, artUTC(2026, 6, 5, 23), 120), 54000)
  })
})

test.group('Timezone — calculateFootballPrice', () => {
  test('22:30-00:00 ART → midnight maps to endH=24, 1.5h × 30000 = 45000', ({ assert }) => {
    assert.equal(calculateFootballPrice(footballRanges, 22000, artUTC(2026, 6, 5, 22, 30), artUTC(2026, 6, 6, 0, 0)), 45000)
  })

  test('midnight end is detected as 00:00 in ART', ({ assert }) => {
    const endART = artUTC(2026, 6, 6, 0, 0).setZone(ART_TZ)
    assert.isTrue(endART.hour === 0 && endART.minute === 0)
  })

  test('10:00-12:00 ART → 2h × 22000 = 44000', ({ assert }) => {
    assert.equal(calculateFootballPrice(footballRanges, 22000, artUTC(2026, 6, 5, 10), artUTC(2026, 6, 5, 12)), 44000)
  })

  test('21:00-23:00 ART crosses ranges → pricier rate for the whole booking', ({ assert }) => {
    // starts at 22000/h, finishes at 30000/h → 30000 × 2h
    assert.equal(calculateFootballPrice(footballRanges, 22000, artUTC(2026, 6, 5, 21), artUTC(2026, 6, 5, 23)), 60000)
  })

  test('23:00 + 60min ends exactly at midnight → 30000', ({ assert }) => {
    assert.equal(calculateFootballPrice(footballRanges, 22000, artUTC(2026, 6, 5, 23), artUTC(2026, 6, 6, 0)), 30000)
  })

  test('23:00 + 90min runs past midnight → 1.5h × 30000, never 0', ({ assert }) => {
    assert.equal(calculateFootballPrice(footballRanges, 22000, artUTC(2026, 6, 5, 23), artUTC(2026, 6, 6, 0, 30)), 45000)
  })

  test('23:00 + 120min runs past midnight → 2h × 30000, never negative', ({ assert }) => {
    assert.equal(calculateFootballPrice(footballRanges, 22000, artUTC(2026, 6, 5, 23), artUTC(2026, 6, 6, 1)), 60000)
  })

  test('a configured after-midnight range prices the tail when pricier', ({ assert }) => {
    const withLateNight = [...footballRanges, { startHour: 0, endHour: 4, pricePerHour: 40000 }]
    // 23:00-01:00 starts at 30000/h, finishes inside the 40000/h range → 40000 × 2h
    assert.equal(calculateFootballPrice(withLateNight, 22000, artUTC(2026, 6, 5, 23), artUTC(2026, 6, 6, 1)), 80000)
  })
})

test.group('Timezone — applyDiscount', () => {
  test('10% off 40500 → 36450', ({ assert }) => {
    assert.equal(applyDiscount(40500, 10), 36450)
  })

  test('0% → no change', ({ assert }) => {
    assert.equal(applyDiscount(40500, 0), 40500)
  })

  test('null % → no change', ({ assert }) => {
    assert.equal(applyDiscount(40500, null), 40500)
  })
})

test.group('Timezone — isWeekend', () => {
  test('Friday 22:30 ART (=Saturday UTC) → NOT weekend', ({ assert }) => {
    const fri = artUTC(2026, 6, 5, 22, 30)
    assert.isFalse(isWeekend(fri))
    assert.equal(fri.toUTC().weekday, 6, 'Confirms UTC sees Saturday')
  })

  test('Saturday 10:00 ART → IS weekend', ({ assert }) => {
    assert.isTrue(isWeekend(artUTC(2026, 6, 6, 10)))
  })

  test('Sunday 9:00 ART → IS weekend', ({ assert }) => {
    assert.isTrue(isWeekend(artUTC(2026, 6, 7, 9)))
  })

  test('Monday 10:00 ART → NOT weekend', ({ assert }) => {
    assert.isFalse(isWeekend(artUTC(2026, 6, 8, 10)))
  })

  test('Saturday 00:00 ART (=Friday 21:00 UTC) → IS weekend', ({ assert }) => {
    assert.isTrue(isWeekend(artUTC(2026, 6, 6, 0, 0)))
  })
})

test.group('Timezone — timeInMinutes', () => {
  test('22:30 ART stored as 01:30 UTC → 1350 min', ({ assert }) => {
    const utc = artUTC(2026, 6, 5, 22, 30)
    assert.equal(utc.hour, 1, 'Stored as UTC hour=1')
    assert.equal(timeInMinutes(utc), 1350)
  })

  test('8:00 ART → 480 min', ({ assert }) => {
    assert.equal(timeInMinutes(artUTC(2026, 6, 5, 8)), 480)
  })

  test('midnight ART → 0 (caller treats this as 24*60)', ({ assert }) => {
    assert.equal(timeInMinutes(artUTC(2026, 6, 5, 0)), 0)
  })

  test('23:59 ART → 1439 min', ({ assert }) => {
    assert.equal(timeInMinutes(artUTC(2026, 6, 5, 23, 59)), 1439)
  })
})

test.group('Timezone — hasRecurringConflict', () => {
  const mkRes = (startART: DateTime, endART: DateTime, hiddenDates: string[] = []): FakeReservation => ({
    startTime: startART.toUTC(),
    endTime: endART.toUTC(),
    hiddenDates,
  })

  test('same weekday + overlapping time → conflict', ({ assert }) => {
    const existing = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30))
    assert.isTrue(hasRecurringConflict([existing], artUTC(2026, 6, 5, 22), artUTC(2026, 6, 5, 23, 30)))
  })

  test('different weekday → no conflict', ({ assert }) => {
    const existing = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30))
    assert.isFalse(hasRecurringConflict([existing], artUTC(2026, 6, 6, 22), artUTC(2026, 6, 6, 23, 30)))
  })

  test('same weekday, non-overlapping time → no conflict', ({ assert }) => {
    const existing = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30))
    assert.isFalse(hasRecurringConflict([existing], artUTC(2026, 6, 5, 23, 30), artUTC(2026, 6, 6, 0, 30)))
  })

  test('partial overlap → conflict', ({ assert }) => {
    const existing = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30))
    assert.isTrue(hasRecurringConflict([existing], artUTC(2026, 6, 5, 22, 45), artUTC(2026, 6, 6, 0)))
  })

  test('date in hiddenDates → conflict skipped', ({ assert }) => {
    const existing = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30), ['2026-06-05'])
    assert.isFalse(hasRecurringConflict([existing], artUTC(2026, 6, 5, 22), artUTC(2026, 6, 5, 23, 30)))
  })

  test('new booking before existing start date → no conflict', ({ assert }) => {
    const existing = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30))
    assert.isFalse(hasRecurringConflict([existing], artUTC(2026, 5, 22, 22), artUTC(2026, 5, 22, 23, 30)))
  })

  test('late-night ART booking: UTC weekday creates false-positives, ART weekday prevents them', ({ assert }) => {
    // Existing recurring: Friday 22:00 ART → Saturday 01:00 UTC (weekday 6)
    // New booking: Saturday 10:00 ART → Saturday 13:00 UTC (weekday 6)
    // UTC weekday check: 6 == 6 → would wrongly consider them the same day
    // ART weekday check: Friday(5) != Saturday(6) → correctly different days
    const fridayNight = mkRes(art(2026, 5, 29, 22), art(2026, 5, 29, 23, 30))
    const fridayNightUTCWeekday  = fridayNight.startTime.toUTC().weekday    // 6 (Saturday UTC)
    const saturdayDayUTCWeekday  = artUTC(2026, 5, 30, 10).weekday          // also 6 (Saturday UTC)
    const fridayNightARTWeekday  = fridayNight.startTime.setZone(ART_TZ).weekday  // 5 (Friday ART)
    const saturdayDayARTWeekday  = artUTC(2026, 5, 30, 10).setZone(ART_TZ).weekday // 6 (Saturday ART)

    assert.equal(fridayNightUTCWeekday, saturdayDayUTCWeekday,
      'UTC weekdays are the same (6) → would cause false-positive conflict')
    assert.notEqual(fridayNightARTWeekday, saturdayDayARTWeekday,
      'ART weekdays differ (5 vs 6) → correctly detected as different days')

    // The conflict checker using ART weekday correctly returns no conflict
    assert.isFalse(hasRecurringConflict([fridayNight], artUTC(2026, 5, 30, 10), artUTC(2026, 5, 30, 11, 30)))
  })
})

test.group('Timezone — stats date ranges → UTC SQL', () => {
  test('day: 2026-06-05 ART → from=03:00 UTC, to=next day 02:59 UTC', ({ assert }) => {
    const { fromSQL, toSQL } = statsDateRange('day', '2026-06-05')
    assert.isTrue(fromSQL.startsWith('2026-06-05 03:00:00'), `got "${fromSQL}"`)
    assert.isTrue(toSQL.startsWith('2026-06-06 02:59:59'),   `got "${toSQL}"`)
  })

  test('month: 2026-06 ART → from=Jun 1 03:00 UTC, to=Jul 1 02:59 UTC', ({ assert }) => {
    const { fromSQL, toSQL } = statsDateRange('month', '2026-06')
    assert.isTrue(fromSQL.startsWith('2026-06-01 03:00:00'), `got "${fromSQL}"`)
    assert.isTrue(toSQL.startsWith('2026-07-01 02:59:59'),   `got "${toSQL}"`)
  })

  test('year: 2026 ART → from=Jan 1 03:00 UTC, to=Jan 1 2027 02:59 UTC', ({ assert }) => {
    const { fromSQL, toSQL } = statsDateRange('year', '2026')
    assert.isTrue(fromSQL.startsWith('2026-01-01 03:00:00'), `got "${fromSQL}"`)
    assert.isTrue(toSQL.startsWith('2027-01-01 02:59:59'),   `got "${toSQL}"`)
  })
})

test.group('Timezone — availability window', () => {
  test('2026-06-05 → Friday weekday=5, correct UTC SQL bounds', ({ assert }) => {
    const w = availabilityWindow('2026-06-05')
    assert.equal(w.weekday, 5)
    assert.equal(w.dateIso, '2026-06-05')
    assert.isTrue(w.startSQL.startsWith('2026-06-05 03:00:00'), `startSQL got "${w.startSQL}"`)
    assert.isTrue(w.endSQL.startsWith('2026-06-06 02:59:59'),   `endSQL got "${w.endSQL}"`)
  })

  test('2026-06-06 → Saturday weekday=6', ({ assert }) => {
    const w = availabilityWindow('2026-06-06')
    assert.equal(w.weekday, 6)
    assert.isTrue(w.startSQL.startsWith('2026-06-06 03:00:00'), `startSQL got "${w.startSQL}"`)
  })
})

test.group('Timezone — hideOccurrence next-weekday finder', () => {
  test('Friday recurring: next occurrence from Wednesday is Friday', ({ assert }) => {
    const resStart = artUTC(2026, 5, 29, 22)   // Friday
    const now      = artUTC(2026, 6, 3, 10)    // Wednesday
    const next     = nextOccurrenceWeekday(resStart, now)
    assert.equal(next, '2026-06-05')
    assert.equal(DateTime.fromISO(next, { zone: ART_TZ }).weekday, 5)
  })

  test('late-night Friday (=Saturday UTC): next occurrence is still Saturday ART', ({ assert }) => {
    // Reservation every Saturday 22:30 ART (Fri 22:30 = Sat UTC would be wrong)
    const resStart = artUTC(2026, 5, 30, 22, 30) // Saturday ART
    assert.notEqual(resStart.weekday, resStart.setZone(ART_TZ).weekday, 'UTC weekday != ART weekday')
    const next = nextOccurrenceWeekday(resStart, artUTC(2026, 6, 1, 10))
    assert.equal(DateTime.fromISO(next, { zone: ART_TZ }).weekday, 6, 'Saturday (6) in ART')
  })
})

test.group('Timezone — incrementGames occurrence finder', () => {
  test('Wednesday: most recent Friday is last week', ({ assert }) => {
    const occ = thisWeeksOccurrence(artUTC(2026, 5, 29, 22, 30), artUTC(2026, 6, 3, 10))
    assert.equal(occ.toISODate(), '2026-05-29')
    assert.equal(occ.setZone(ART_TZ).weekday, 5)
  })

  test('Friday after game started: occurrence is today', ({ assert }) => {
    const occ = thisWeeksOccurrence(artUTC(2026, 6, 5, 22, 30), artUTC(2026, 6, 5, 23, 59))
    assert.equal(occ.toISODate(), '2026-06-05')
  })

  test('Friday morning before game: occurrence is last Friday', ({ assert }) => {
    const occ = thisWeeksOccurrence(artUTC(2026, 6, 5, 22, 30), artUTC(2026, 6, 5, 10))
    assert.equal(occ.toISODate(), '2026-05-29')
  })
})

test.group('Timezone — professor hour restrictions', () => {
  test('08:00-09:00 ART → within window (8-18)', ({ assert }) => {
    assert.isTrue(professorHoursOk(artUTC(2026, 6, 5, 8), artUTC(2026, 6, 5, 9), 8, 18))
  })

  test('07:59 start → rejected', ({ assert }) => {
    assert.isFalse(professorHoursOk(artUTC(2026, 6, 5, 7, 59), artUTC(2026, 6, 5, 9), 8, 18))
  })

  test('end at 18:01 → rejected', ({ assert }) => {
    assert.isFalse(professorHoursOk(artUTC(2026, 6, 5, 17), artUTC(2026, 6, 5, 18, 1), 8, 18))
  })

  test('17:00-18:00 → exactly at boundary, allowed', ({ assert }) => {
    assert.isTrue(professorHoursOk(artUTC(2026, 6, 5, 17), artUTC(2026, 6, 5, 18), 8, 18))
  })

  test('22:30 ART (=01:30 UTC) → rejected, not accepted as hour=1', ({ assert }) => {
    assert.isFalse(professorHoursOk(artUTC(2026, 6, 5, 22, 30), artUTC(2026, 6, 5, 23, 30), 8, 18))
  })
})

test.group('Timezone — Frontend inART helper', () => {
  test('UTC Z string: 01:30 UTC (=22:30 ART Fri) → hours=22, dateStr=2026-06-05', ({ assert }) => {
    const a = inART('2026-06-06T01:30:00.000Z')
    assert.equal(a.hours, 22)
    assert.equal(a.minutes, 30)
    assert.equal(a.dateStr, '2026-06-05')
    assert.equal(a.dayOfWeek, 5)
  })

  test('offset string -03:00 → hours/dateStr preserved', ({ assert }) => {
    const a = inART('2026-06-05T10:00:00-03:00')
    assert.equal(a.hours, 10)
    assert.equal(a.dateStr, '2026-06-05')
  })

  test('midnight ART → hours=0, minutes=0', ({ assert }) => {
    const a = inART('2026-06-06T00:00:00-03:00')
    assert.equal(a.hours, 0)
    assert.equal(a.minutes, 0)
    assert.equal(a.dateStr, '2026-06-06')
  })
})

test.group('Timezone — Frontend computeOccupiedRanges', () => {
  test('cancelled reservation excluded', ({ assert }) => {
    const res = [
      { id: 1, status: 'confirmed', startTime: '2026-06-05T22:00:00-03:00', endTime: '2026-06-05T23:30:00-03:00' },
      { id: 2, status: 'cancelled', startTime: '2026-06-05T10:00:00-03:00', endTime: '2026-06-05T11:00:00-03:00' },
    ]
    assert.lengthOf(computeOccupiedRanges(res), 1)
  })

  test('22:00-23:30 ART → [1320, 1410]', ({ assert }) => {
    const res = [{ id: 1, status: 'confirmed', startTime: '2026-06-05T22:00:00-03:00', endTime: '2026-06-05T23:30:00-03:00' }]
    const [[s, e]] = computeOccupiedRanges(res)
    assert.equal(s, 1320)
    assert.equal(e, 1410)
  })

  test('midnight-crossing 23:00-01:00 ART → [1380, 1500]', ({ assert }) => {
    const res = [{ id: 1, status: 'confirmed', startTime: '2026-06-05T23:00:00-03:00', endTime: '2026-06-06T01:00:00-03:00' }]
    const [[s, e]] = computeOccupiedRanges(res)
    assert.equal(s, 1380)
    assert.equal(e, 1500)
  })
})

test.group('Timezone — Frontend buildDateTime', () => {
  test('22:30 → emits -03:00 offset, parseable as ART hour=22', ({ assert }) => {
    const iso = buildDateTime('2026-06-05', '22:30')
    assert.equal(iso, '2026-06-05T22:30:00-03:00')
    assert.equal(DateTime.fromISO(iso, { setZone: true }).setZone(ART_TZ).hour, 22)
  })

  test('00:00 slot → bumps to next day midnight', ({ assert }) => {
    assert.equal(buildDateTime('2026-06-05', '00:00'), '2026-06-06T00:00:00-03:00')
  })
})

test.group('Timezone — Frontend expandReservations', () => {
  const fridayRec = {
    id: 42,
    isRecurring: true,
    status: 'confirmed',
    startTime: '2026-05-29T22:30:00-03:00',
    endTime:   '2026-05-29T23:30:00-03:00',
    hiddenDates: [] as string[],
  }

  test('Friday recurring expands on 2026-06-05 (next Friday)', ({ assert }) => {
    const occ = expandRecurringForDate(fridayRec, '2026-06-05')
    assert.isNotNull(occ)
    assert.equal(occ!.startTime, '2026-06-05T22:30:00.000-03:00')
  })

  test('Friday recurring does NOT expand on Saturday', ({ assert }) => {
    assert.isNull(expandRecurringForDate(fridayRec, '2026-06-06'))
  })

  test('hidden date suppresses occurrence', ({ assert }) => {
    assert.isNull(expandRecurringForDate({ ...fridayRec, hiddenDates: ['2026-06-05'] }, '2026-06-05'))
  })

  test('Saturday 22:30 recurring expands on next Saturday, not Friday', ({ assert }) => {
    const satRec = { ...fridayRec, id: 99, startTime: '2026-05-30T22:30:00-03:00', endTime: '2026-05-31T00:00:00-03:00' }
    assert.isNull(expandRecurringForDate(satRec, '2026-06-05'), 'Friday → null')
    const occ = expandRecurringForDate(satRec, '2026-06-06')
    assert.isNotNull(occ)
    assert.isTrue(occ!.startTime.startsWith('2026-06-06'))
  })
})

test.group('Timezone — Frontend getNextOccurrenceDate', () => {
  test('next occurrence of Friday recurring is a Friday', ({ assert }) => {
    const next = getNextOccurrenceDate('2026-05-29T22:30:00-03:00')
    assert.equal(DateTime.fromISO(next, { zone: ART_TZ }).weekday, 5)
  })

  test('hidden date skips to the following week', ({ assert }) => {
    const next = getNextOccurrenceDate('2026-05-29T22:30:00-03:00')
    const nextWithHidden = getNextOccurrenceDate('2026-05-29T22:30:00-03:00', [next])
    const expected = DateTime.fromISO(next, { zone: ART_TZ }).plus({ weeks: 1 }).toISODate()!
    assert.equal(nextWithHidden, expected)
  })
})
