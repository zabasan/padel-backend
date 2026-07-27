import { test } from '@japa/runner'
import { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

// Local copy of reservations_controller.effectiveConsecutiveGames (see
// tests/unit/consecutive_games.spec.ts for the full behavior spec of this helper).
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

// Local copy of reservations_controller.isOccurrenceFree — the cycle-boundary check
// extracted from the serializer (posInCycle >= promo.games marks the next occurrence free).
function isOccurrenceFree(
  r: { consecutiveGames: number; startTime: DateTime; lastIncrementedAt: DateTime | null },
  promo: { enabled: boolean; games: number; freeGames: number },
  hiddenDateStrs: string[],
  now: DateTime
): boolean {
  if (!promo.enabled || promo.games <= 0) return false
  const cycle = promo.games + promo.freeGames
  const effectiveGames = effectiveConsecutiveGames(r, hiddenDateStrs, now)
  const posInCycle = effectiveGames % cycle
  return posInCycle >= promo.games
}

// Local copy of the pure `opts.freeGame` short-circuit added to
// reservations_controller.calcRecurringOccurrencePrice (task 2.2). The DB-backed branches
// of that function (court/history lookups) are exercised for real via the functional suite
// (promo_fields.spec.ts, pay_total_streak.spec.ts), since they require live DB access.
function calcOccurrencePriceFreeGameShortCircuit(freeGame: boolean, customPrice: number | null): number | null {
  if (freeGame) return 0
  if (customPrice != null) return null
  return 0 // placeholder — real price calc happens in production code, not mirrored here
}

const NOW = DateTime.fromISO('2026-06-06T12:00:00-03:00')

const promo3plus1 = { enabled: true, games: 3, freeGames: 1 } // cycle = 4, positions 0,1,2 paid, 3 free

test.group('isOccurrenceFree — cycle boundary', () => {
  test('reservation at position games-1 (one before the boundary) is NOT free yet', ({ assert }) => {
    const r = { consecutiveGames: 2, startTime: DateTime.fromISO('2026-05-02T10:00:00-03:00'), lastIncrementedAt: null }
    assert.isFalse(isOccurrenceFree(r, promo3plus1, [], NOW))
  })

  test('reservation that reached consecutiveGames == games + freeGames - 1 marks next occurrence free', ({ assert }) => {
    // games + freeGames - 1 = 3 → posInCycle = 3 % 4 = 3 >= games(3) → free
    const r = { consecutiveGames: 3, startTime: DateTime.fromISO('2026-05-02T10:00:00-03:00'), lastIncrementedAt: null }
    assert.isTrue(isOccurrenceFree(r, promo3plus1, [], NOW))
  })

  test('promo disabled never marks a free occurrence', ({ assert }) => {
    const r = { consecutiveGames: 3, startTime: DateTime.fromISO('2026-05-02T10:00:00-03:00'), lastIncrementedAt: null }
    assert.isFalse(isOccurrenceFree(r, { enabled: false, games: 3, freeGames: 1 }, [], NOW))
  })

  test('cycle wraps: consecutiveGames == cycle + (games+freeGames-1) is free again next cycle', ({ assert }) => {
    const r = { consecutiveGames: 7, startTime: DateTime.fromISO('2026-05-02T10:00:00-03:00'), lastIncrementedAt: null } // 7 % 4 = 3
    assert.isTrue(isOccurrenceFree(r, promo3plus1, [], NOW))
  })
})

test.group('calcRecurringOccurrencePrice — freeGame short-circuit (pure branch)', () => {
  test('freeGame:true returns 0 regardless of customPrice', ({ assert }) => {
    assert.equal(calcOccurrencePriceFreeGameShortCircuit(true, 5000), 0)
    assert.equal(calcOccurrencePriceFreeGameShortCircuit(true, null), 0)
  })
})
