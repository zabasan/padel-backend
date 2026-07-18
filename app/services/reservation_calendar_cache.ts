import type { DateTime } from 'luxon'

/**
 * In-memory (single-process) cache for the past, frozen portion of the calendar
 * listing (`GET /reservations?from&to`).
 *
 * Only NON-recurring reservations whose start_time is strictly before "today"
 * (ART) are cached — they can no longer change on their own, so serving them for
 * 12h avoids re-querying + re-serializing the same rows on every calendar swipe.
 * Recurring series and the today-onward segment are always fetched live by the
 * controller and are never stored here.
 *
 * A cache entry covers the past window [fromMs, toMs] (UTC millis). When a
 * past-dated reservation is mutated, `invalidateAt(ms)` drops every entry whose
 * window contains that instant, so the next request rebuilds it from the DB.
 *
 * The store lives in the Node process: it starts empty, repopulates lazily, and
 * is lost on restart — which is fine, it just warms up again on first hit.
 */
type CacheEntry = {
  rows: Record<string, any>[]
  expiresAt: number
  fromMs: number
  toMs: number
}

const TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

class ReservationCalendarCache {
  private store = new Map<string, CacheEntry>()

  private keyOf(fromMs: number, toMs: number): string {
    return `${fromMs}:${toMs}`
  }

  /** Returns the cached serialized rows for a past window, or null on miss/expiry. */
  get(fromMs: number, toMs: number): Record<string, any>[] | null {
    const key = this.keyOf(fromMs, toMs)
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.rows
  }

  /** Caches serialized rows for a past window for 12h. */
  set(fromMs: number, toMs: number, rows: Record<string, any>[]): void {
    this.store.set(this.keyOf(fromMs, toMs), {
      rows,
      expiresAt: Date.now() + TTL_MS,
      fromMs,
      toMs,
    })
  }

  /**
   * Drops every cached window that contains `ms`. Called after mutating a
   * reservation so any stored past segment covering its date is rebuilt.
   * A no-op when no window matches (e.g. today/future mutations), so callers
   * can invoke it liberally — over-invalidation only costs a re-query.
   */
  invalidateAt(ms: number): void {
    for (const [key, entry] of this.store) {
      if (ms >= entry.fromMs && ms <= entry.toMs) {
        this.store.delete(key)
      }
    }
  }

  /** Convenience: invalidate by a Luxon DateTime (reservation start_time). */
  invalidateFor(startTime: DateTime): void {
    this.invalidateAt(startTime.toMillis())
  }

  /** Wipes the whole cache. */
  clear(): void {
    this.store.clear()
  }
}

export default new ReservationCalendarCache()
