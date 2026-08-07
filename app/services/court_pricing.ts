import type { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

/**
 * Shape shared by CourtPriceRange (current prices) and CourtPriceHistory
 * (prices frozen at the time a past occurrence was played).
 */
export interface PriceRangeLike {
  startHour: number
  endHour: number
  pricePerHour: number
  price60Min?: number | null
  price90Min?: number | null
  price120Min?: number | null
}

export interface PricedCourt {
  type: string
  pricePerHour: number
}

/** Ranges store the closing edge as 24 (midnight); tolerate a stored 0 as well. */
function normalizedEnd(range: PriceRangeLike): number {
  return range.endHour === 0 || range.endHour >= 24 ? 24 : range.endHour
}

/** Missing per-duration prices arrive as either null (DB) or undefined (unset). */
function optionalNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}

/**
 * What this range charges for a booking of `durationMinutes`.
 * Padel is sold in fixed slots with their own prices; everything else is hourly.
 */
function priceForRange(
  range: PriceRangeLike,
  durationMinutes: number,
  usePerDurationPrices: boolean
): number {
  if (usePerDurationPrices) {
    const slotPrice =
      durationMinutes === 60
        ? optionalNumber(range.price60Min)
        : durationMinutes === 90
          ? optionalNumber(range.price90Min)
          : durationMinutes === 120
            ? optionalNumber(range.price120Min)
            : null
    if (slotPrice !== null) return slotPrice
  }
  return Number(range.pricePerHour) * (durationMinutes / 60)
}

/** Range containing the starting instant. Range starts are inclusive. */
function rangeAtStart(ranges: PriceRangeLike[], hour: number): PriceRangeLike | undefined {
  return ranges.find((r) => hour >= r.startHour && hour < normalizedEnd(r))
}

/**
 * Range containing the last instant played. Ends are exclusive, so a booking
 * finishing exactly on a boundary (19:00-20:00 against an 8-20 range) stays in
 * the range it started in instead of reaching into the next one.
 */
function rangeAtEnd(ranges: PriceRangeLike[], hour: number): PriceRangeLike | undefined {
  return ranges.find((r) => hour > r.startHour && hour <= normalizedEnd(r))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A booking is charged at a SINGLE rate — the range it starts in — except when it
 * finishes inside a different range, in which case the more expensive of the two wins.
 * That rate is then applied to the full duration.
 *
 * Duration comes from the actual start/end difference, so bookings running past
 * midnight (23:00 + 120min) are priced on their real length instead of a
 * clock-hour subtraction that would go negative.
 */
export function calculateCourtPrice(
  court: PricedCourt,
  priceRanges: PriceRangeLike[],
  start: DateTime,
  end: DateTime
): number {
  const durationMinutes = Math.round(end.diff(start, 'minutes').minutes)
  const usePerDurationPrices = court.type === 'padel'
  const fallback = Number(court.pricePerHour) * (durationMinutes / 60)

  if (priceRanges.length === 0) return round(fallback)

  const startART = start.setZone(ART_TZ)
  const endART = end.setZone(ART_TZ)
  const startHour = startART.hour + startART.minute / 60
  // Finishing at 00:00 is the close of the current day, not the start of the next one.
  const endHour = endART.hour === 0 && endART.minute === 0 ? 24 : endART.hour + endART.minute / 60

  const applicable = [
    rangeAtStart(priceRanges, startHour),
    rangeAtEnd(priceRanges, endHour),
  ].filter((r): r is PriceRangeLike => r !== undefined)

  if (applicable.length === 0) return round(fallback)

  return round(
    Math.max(...applicable.map((r) => priceForRange(r, durationMinutes, usePerDurationPrices)))
  )
}
