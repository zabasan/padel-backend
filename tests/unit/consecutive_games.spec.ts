import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

// Local copy of the controller helper with injectable `now` for deterministic tests
function effectiveConsecutiveGames(
  r: { consecutiveGames: number; startTime: DateTime; lastIncrementedAt: DateTime | null },
  hiddenDateStrs: string[],
  now: DateTime
): number {
  if (!hiddenDateStrs.length) return r.consecutiveGames

  const nowART = now.setZone(ART_TZ)
  const resStartART = r.startTime.setZone(ART_TZ)
  const lastIncremented = r.lastIncrementedAt ? r.lastIncrementedAt.setZone(ART_TZ) : null

  let latestBreaker: DateTime | null = null
  for (const dateStr of hiddenDateStrs) {
    const hdDt = DateTime.fromISO(dateStr, { zone: ART_TZ }).set({
      hour: resStartART.hour,
      minute: resStartART.minute,
      second: 0,
      millisecond: 0,
    })
    if (hdDt >= nowART) continue
    const afterLast = lastIncremented ? hdDt > lastIncremented : hdDt >= resStartART.startOf('day')
    if (!afterLast) continue
    if (!latestBreaker || hdDt > latestBreaker) latestBreaker = hdDt
  }

  if (!latestBreaker) return r.consecutiveGames

  let streak = 0
  let cur = latestBreaker.plus({ weeks: 1 })
  while (cur < nowART) {
    const dateStr = cur.toISODate()!
    if (!hiddenDateStrs.includes(dateStr)) streak++
    cur = cur.plus({ weeks: 1 })
  }
  return streak
}

function makeRes(opts: {
  startTime: string
  consecutiveGames: number
  lastIncrementedAt?: string | null
}) {
  return {
    consecutiveGames: opts.consecutiveGames,
    startTime: DateTime.fromISO(opts.startTime),
    lastIncrementedAt: opts.lastIncrementedAt ? DateTime.fromISO(opts.lastIncrementedAt) : null,
  }
}

// "now" = 2026-06-06 12:00 ART (Saturday)
const NOW = DateTime.fromISO('2026-06-06T12:00:00-03:00')

// Weekly Saturday reservation at 10:00 ART, started 2026-05-02
// Past occurrences: 02/05, 09/05, 16/05, 23/05, 30/05, 06/06 (10:00 < 12:00 → counts)
// lastIncrementedAt = 16/05 → only hidden dates AFTER 16/05 are eligible breakers
const SAT_RES = makeRes({
  startTime: '2026-05-02T10:00:00-03:00',
  consecutiveGames: 3,
  lastIncrementedAt: '2026-05-16T10:30:00-03:00',
})

test.group('effectiveConsecutiveGames — no hidden dates', () => {
  test('returns stored consecutiveGames unchanged', ({ assert }) => {
    assert.equal(effectiveConsecutiveGames(SAT_RES, [], NOW), 3)
  })
})

test.group('effectiveConsecutiveGames — future hidden date (not yet a breaker)', () => {
  test('future hidden date does not change the streak', ({ assert }) => {
    // 2026-06-13 is next Saturday — still in the future
    assert.equal(effectiveConsecutiveGames(SAT_RES, ['2026-06-13'], NOW), 3)
  })
})

test.group('effectiveConsecutiveGames — past hidden date breaks the streak', () => {
  test('hidden 23/05 resets streak; 30/05 and 06/06 played → streak = 2', ({ assert }) => {
    // lastIncrementedAt = 16/05; 23/05 > 16/05 → valid breaker
    // After breaker: 30/05 ✓, 06/06 ✓ (10:00 < 12:00) → 2
    assert.equal(effectiveConsecutiveGames(SAT_RES, ['2026-05-23'], NOW), 2)
  })

  test('hidden 30/05 resets streak; only 06/06 played after → streak = 1', ({ assert }) => {
    // After 30/05 breaker: 06/06 ✓ → 1
    assert.equal(effectiveConsecutiveGames(SAT_RES, ['2026-05-30'], NOW), 1)
  })

  test('most recent breaker wins; hidden 23/05 and 30/05 → only 06/06 after → streak = 1', ({ assert }) => {
    assert.equal(effectiveConsecutiveGames(SAT_RES, ['2026-05-23', '2026-05-30'], NOW), 1)
  })

  test('regression — past hidden date must NOT preserve the stale stored value', ({ assert }) => {
    const result = effectiveConsecutiveGames(SAT_RES, ['2026-05-23'], NOW)
    assert.notEqual(result, SAT_RES.consecutiveGames) // stored=3, correct=2
  })
})

test.group('effectiveConsecutiveGames — hidden date before lastIncrementedAt is ignored', () => {
  test('old hidden date before lastIncrementedAt does not re-break streak', ({ assert }) => {
    // lastIncrementedAt = 30/05; hidden 16/05 is before it → ignored
    const res = makeRes({
      startTime: '2026-05-02T10:00:00-03:00',
      consecutiveGames: 3,
      lastIncrementedAt: '2026-05-30T10:30:00-03:00',
    })
    assert.equal(effectiveConsecutiveGames(res, ['2026-05-16'], NOW), 3)
  })
})

test.group('effectiveConsecutiveGames — no lastIncrementedAt (never played)', () => {
  test('past hidden date with no prior increment counts streak from breaker forward', ({ assert }) => {
    // No lastIncrementedAt → hidden 23/05 is a valid breaker from start
    // After breaker: 30/05 ✓, 06/06 ✓ → streak = 2
    const res = makeRes({
      startTime: '2026-05-02T10:00:00-03:00',
      consecutiveGames: 0,
      lastIncrementedAt: null,
    })
    assert.equal(effectiveConsecutiveGames(res, ['2026-05-23'], NOW), 2)
  })
})

test.group('effectiveConsecutiveGames — multiple played games after the breaker', () => {
  test('hidden 16/05; played 23/05, 30/05, 06/06 → streak = 3', ({ assert }) => {
    // lastIncrementedAt = 09/05; 16/05 > 09/05 → valid breaker
    // After breaker: 23/05 ✓, 30/05 ✓, 06/06 ✓ (10:00 < 12:00) → 3
    const res = makeRes({
      startTime: '2026-05-02T10:00:00-03:00',
      consecutiveGames: 5,
      lastIncrementedAt: '2026-05-09T10:30:00-03:00',
    })
    assert.equal(effectiveConsecutiveGames(res, ['2026-05-16'], NOW), 3)
  })
})
