import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

// Local copy of the controller helper with injectable `startTime`/`from`, mirroring
// production `nextOccurrenceDate` + `nextDueOccurrence` in reservations_controller.ts.
// See tests/unit/consecutive_games.spec.ts for the established local-copy convention
// used for pure ART-timezone helpers that aren't exported from the controller.
function nextOccurrenceDate(startTime: DateTime, from: DateTime): DateTime {
  const resStartART = startTime.setZone(ART_TZ)
  const weekday = resStartART.weekday
  let candidate = from.setZone(ART_TZ).startOf('day')
  while (candidate.weekday !== weekday) candidate = candidate.plus({ days: 1 })
  return candidate
}

// Hidden-date-aware "next due" occurrence: skips any candidate that is already hidden.
function nextDueOccurrence(startTime: DateTime, from: DateTime, hiddenDateStrs: string[]): DateTime {
  let candidate = nextOccurrenceDate(startTime, from)
  while (hiddenDateStrs.includes(candidate.toISODate()!)) {
    candidate = candidate.plus({ weeks: 1 })
  }
  return candidate
}

// Weekly Saturday reservation at 10:00 ART, started 2026-05-02
const SAT_START = DateTime.fromISO('2026-05-02T10:00:00-03:00')
// "now" = Saturday 2026-06-06 09:00 ART — before that Saturday's occurrence starts
const NOW = DateTime.fromISO('2026-06-06T09:00:00-03:00')

test.group('nextDueOccurrence — no hidden dates', () => {
  test('matches nextOccurrenceDate when nothing is hidden', ({ assert }) => {
    assert.equal(nextDueOccurrence(SAT_START, NOW, []).toISODate(), '2026-06-06')
  })
})

test.group('nextDueOccurrence — skips already-hidden occurrences', () => {
  test('skips the immediate occurrence when it is hidden, lands on the following week', ({ assert }) => {
    assert.equal(nextDueOccurrence(SAT_START, NOW, ['2026-06-06']).toISODate(), '2026-06-13')
  })

  test('skips multiple consecutive hidden occurrences', ({ assert }) => {
    assert.equal(nextDueOccurrence(SAT_START, NOW, ['2026-06-06', '2026-06-13']).toISODate(), '2026-06-20')
  })

  test('ignores hidden dates that do not match the pending occurrence', ({ assert }) => {
    assert.equal(nextDueOccurrence(SAT_START, NOW, ['2026-07-04']).toISODate(), '2026-06-06')
  })
})
