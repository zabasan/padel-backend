import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

// ─── Helpers (mirror controllers/model) ──────────────────────────────────────

// Mirrors the `consume` added to ReservationPayment.occurrenceDate — a MySQL `date`
// column comes back as a full datetime ('2026-07-03T00:00:00.000Z') or a Date object,
// and must be flattened to 'YYYY-MM-DD' so it matches occurrence date strings.
function normalizeOccurrenceDate(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

interface FakePayment {
  type: 'deposit' | 'total'
  occurrenceDate: unknown // string | Date | null — as it may arrive from the DB
  total?: number
  expectedAmount?: number | null
}

// Mirrors reservations_controller.computeCarryBalance: net Σ(total − expectedAmount) over
// TOTAL payments with a non-null expectedAmount. Negative → debt, positive → credit.
function computeCarryBalance(payments: FakePayment[]): number {
  let saldo = 0
  for (const p of payments) {
    if (p.type !== 'total' || p.expectedAmount == null) continue
    saldo += Number(p.total) - Number(p.expectedAmount)
  }
  return Math.round(saldo * 100) / 100
}

const payFull = (total: number, expectedAmount: number | null, occurrenceDate: unknown = '2026-07-03'): FakePayment =>
  ({ type: 'total', occurrenceDate, total, expectedAmount })

// Mirrors reservations_controller.index: only TOTAL payments with an occurrence_date
// contribute to the per-occurrence paid set (deposit is series-level, not per occurrence).
function paidOccurrencesFromPayments(payments: FakePayment[]): string[] {
  const dates: string[] = []
  for (const p of payments) {
    const d = normalizeOccurrenceDate(p.occurrenceDate)
    if (d && p.type === 'total') dates.push(d)
  }
  return dates
}

// Mirrors CalendarPage.expandReservations: an occurrence is paid iff its date is in the set.
function isOccurrencePaid(paidOccurrences: string[], occurrenceDateStr: string): boolean {
  return paidOccurrences.includes(occurrenceDateStr)
}

// Mirrors reservations_controller.nextOccurrenceDate (weekday resolved in ART, `from` inclusive).
function nextOccurrenceDate(resStartUTC: DateTime, fromUTC: DateTime): string {
  const weekday = resStartUTC.setZone(ART_TZ).weekday
  let candidate = fromUTC.setZone(ART_TZ).startOf('day')
  while (candidate.weekday !== weekday) candidate = candidate.plus({ days: 1 })
  return candidate.toISODate()!
}

// Mirrors the list-page `obj.totalPaid`: is the NEXT occurrence paid?
function nextOccurrenceTotalPaid(payments: FakePayment[], resStartUTC: DateTime, fromUTC: DateTime): boolean {
  const next = nextOccurrenceDate(resStartUTC, fromUTC)
  return isOccurrencePaid(paidOccurrencesFromPayments(payments), next)
}

const art = (y: number, mo: number, d: number, h: number, mi = 0) =>
  DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi }, { zone: ART_TZ })
const artUTC = (y: number, mo: number, d: number, h: number, mi = 0) => art(y, mo, d, h, mi).toUTC()

const pay = (type: 'deposit' | 'total', occurrenceDate: unknown): FakePayment => ({ type, occurrenceDate })

// ─── Tests ───────────────────────────────────────────────────────────────────

test.group('Recurring payments — occurrence_date normalization', () => {
  test('full ISO datetime (as DB returns it) → YYYY-MM-DD', ({ assert }) => {
    assert.equal(normalizeOccurrenceDate('2026-07-03T00:00:00.000Z'), '2026-07-03')
  })

  test('plain date string → unchanged', ({ assert }) => {
    assert.equal(normalizeOccurrenceDate('2026-07-03'), '2026-07-03')
  })

  test('JS Date object → YYYY-MM-DD', ({ assert }) => {
    assert.equal(normalizeOccurrenceDate(new Date('2026-07-03T00:00:00.000Z')), '2026-07-03')
  })

  test('null → null', ({ assert }) => {
    assert.equal(normalizeOccurrenceDate(null), null)
  })

  test('REGRESSION: without normalization the datetime string would NOT match the date cell', ({ assert }) => {
    // This is the bug found during live verification: the raw value did not equal the
    // calendar dateStr, so a paid week rendered as unpaid.
    assert.notEqual('2026-07-03T00:00:00.000Z', '2026-07-03')
    assert.equal(normalizeOccurrenceDate('2026-07-03T00:00:00.000Z'), '2026-07-03')
  })
})

test.group('Recurring payments — paidOccurrences set', () => {
  test('a single total payment yields exactly that date', ({ assert }) => {
    assert.deepEqual(paidOccurrencesFromPayments([pay('total', '2026-07-03')]), ['2026-07-03'])
  })

  test('deposit payments are excluded (deposit is series-level, not per occurrence)', ({ assert }) => {
    assert.deepEqual(paidOccurrencesFromPayments([pay('deposit', '2026-07-03')]), [])
  })

  test('payments with null occurrence_date (pre-feature) are excluded', ({ assert }) => {
    assert.deepEqual(paidOccurrencesFromPayments([pay('total', null)]), [])
  })

  test('mixes datetime + date + Date object, normalizes all', ({ assert }) => {
    const set = paidOccurrencesFromPayments([
      pay('total', '2026-07-03T00:00:00.000Z'),
      pay('total', '2026-07-17'),
      pay('total', new Date('2026-07-24T00:00:00.000Z')),
      pay('deposit', '2026-07-03'),
    ])
    assert.deepEqual(set, ['2026-07-03', '2026-07-17', '2026-07-24'])
  })

  test('no payments → empty set', ({ assert }) => {
    assert.deepEqual(paidOccurrencesFromPayments([]), [])
  })
})

test.group('Recurring payments — per-occurrence isolation (the reported bug)', () => {
  const payments = [pay('total', '2026-07-03T00:00:00.000Z')] // paid this Friday only
  const paid = paidOccurrencesFromPayments(payments)

  test('the paid week shows as paid', ({ assert }) => {
    assert.isTrue(isOccurrencePaid(paid, '2026-07-03'))
  })

  test('REGRESSION: the NEXT week of the same fija does NOT show as paid', ({ assert }) => {
    assert.isFalse(isOccurrencePaid(paid, '2026-07-10'))
  })

  test('the previous week is also unaffected', ({ assert }) => {
    assert.isFalse(isOccurrencePaid(paid, '2026-06-26'))
  })

  test('paying two non-consecutive weeks marks only those two', ({ assert }) => {
    const p = paidOccurrencesFromPayments([pay('total', '2026-07-03'), pay('total', '2026-07-17')])
    assert.isTrue(isOccurrencePaid(p, '2026-07-03'))
    assert.isFalse(isOccurrencePaid(p, '2026-07-10'))
    assert.isTrue(isOccurrencePaid(p, '2026-07-17'))
  })
})

test.group('Recurring payments — list page next-occurrence flag', () => {
  // Reservation recurs Fridays 20:00 ART (23:00 UTC). "Now" is Sat 2026-06-27.
  const resStart = artUTC(2026, 7, 3, 20) // a Friday 20:00 ART
  const now = artUTC(2026, 6, 27, 12) // Saturday

  test('next occurrence resolves to the upcoming Friday', ({ assert }) => {
    assert.equal(nextOccurrenceDate(resStart, now), '2026-07-03')
    assert.equal(DateTime.fromISO('2026-07-03', { zone: ART_TZ }).weekday, 5)
  })

  test('totalPaid=true when the next occurrence has a payment', ({ assert }) => {
    assert.isTrue(nextOccurrenceTotalPaid([pay('total', '2026-07-03')], resStart, now))
  })

  test('totalPaid=false when only a LATER week is paid', ({ assert }) => {
    assert.isFalse(nextOccurrenceTotalPaid([pay('total', '2026-07-10')], resStart, now))
  })

  test('totalPaid=false when only a deposit exists for the next occurrence', ({ assert }) => {
    assert.isFalse(nextOccurrenceTotalPaid([pay('deposit', '2026-07-03')], resStart, now))
  })
})

test.group('Recurring payments — carry balance (deuda/crédito arrastrado)', () => {
  test('pago exacto → saldo 0', ({ assert }) => {
    assert.equal(computeCarryBalance([payFull(30000, 30000)]), 0)
  })

  test('pago de menos → saldo negativo (deuda)', ({ assert }) => {
    assert.equal(computeCarryBalance([payFull(27000, 30000)]), -3000)
  })

  test('pago de más → saldo positivo (crédito)', ({ assert }) => {
    assert.equal(computeCarryBalance([payFull(35000, 30000)]), 5000)
  })

  test('serie que salda la deuda → 0 (semana 1 debe 3k, semana 2 paga 33k)', ({ assert }) => {
    const payments = [
      payFull(27000, 30000, '2026-07-03'),
      payFull(33000, 30000, '2026-07-10'),
    ]
    assert.equal(computeCarryBalance(payments), 0)
  })

  test('crédito rueda a través de una semana oculta (sin pago) hasta la próxima cobrada', ({ assert }) => {
    // Semana 1: pagó de más 5k. Semana 2 oculta → sin fila. Semana 3: precio 30k, cobra 25k.
    const payments = [
      payFull(35000, 30000, '2026-07-03'),
      payFull(25000, 30000, '2026-07-17'),
    ]
    assert.equal(computeCarryBalance(payments), 0)
  })

  test('expectedAmount null (pagos pre-feature) se excluyen del saldo', ({ assert }) => {
    assert.equal(computeCarryBalance([payFull(27000, null)]), 0)
    assert.equal(computeCarryBalance([{ type: 'total', occurrenceDate: '2026-07-03', total: 27000 }]), 0)
  })

  test('pagos de tipo deposit no afectan el saldo', ({ assert }) => {
    const payments: FakePayment[] = [
      { type: 'deposit', occurrenceDate: '2026-07-03', total: 5000, expectedAmount: 30000 },
      payFull(27000, 30000, '2026-07-03'),
    ]
    assert.equal(computeCarryBalance(payments), -3000)
  })

  test('revertir un pago (quitar la fila) recalcula el saldo', ({ assert }) => {
    const all = [payFull(27000, 30000, '2026-07-03'), payFull(20000, 30000, '2026-07-10')]
    assert.equal(computeCarryBalance(all), -13000)
    // Se revierte el pago de la semana 2 → queda solo la deuda de la semana 1.
    assert.equal(computeCarryBalance([all[0]]), -3000)
  })

  test('sin pagos → saldo 0', ({ assert }) => {
    assert.equal(computeCarryBalance([]), 0)
  })
})

test.group('Recurring payments — timezone edge (late-night Friday)', () => {
  // Friday 22:30 ART is stored as Saturday 01:30 UTC. The occurrence date must stay
  // the Friday in ART, and a payment dated to that Friday must match the Friday cell.
  const resStart = artUTC(2026, 7, 3, 22, 30) // Friday 22:30 ART → Sat 01:30 UTC

  test('UTC weekday is Saturday but ART weekday is Friday', ({ assert }) => {
    assert.equal(resStart.weekday, 6, 'stored UTC sees Saturday')
    assert.equal(resStart.setZone(ART_TZ).weekday, 5, 'ART sees Friday')
  })

  test('next occurrence resolves to a Friday, not Saturday', ({ assert }) => {
    const next = nextOccurrenceDate(resStart, artUTC(2026, 7, 1, 10)) // Wednesday
    assert.equal(DateTime.fromISO(next, { zone: ART_TZ }).weekday, 5)
    assert.equal(next, '2026-07-03')
  })

  test('a payment for the Friday occurrence matches the Friday cell', ({ assert }) => {
    const paid = paidOccurrencesFromPayments([pay('total', '2026-07-03')])
    assert.isTrue(isOccurrencePaid(paid, '2026-07-03'))
    assert.isFalse(isOccurrencePaid(paid, '2026-07-04'), 'does not bleed into Saturday')
  })
})
