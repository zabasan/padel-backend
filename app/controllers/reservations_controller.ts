import type { HttpContext } from '@adonisjs/core/http'
import Reservation from '#models/reservation'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import ReservationAuditLog from '#models/reservation_audit_log'
import ReservationPayment from '#models/reservation_payment'
import { currentCashSessionId } from '#services/cash_register'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import CourtPriceHistory from '#models/court_price_history'
import ProfessorPriceHistory from '#models/professor_price_history'
import Setting from '#models/setting'
import User from '#models/user'
import reservationCalendarCache from '#services/reservation_calendar_cache'
import { calculateCourtPrice } from '#services/court_pricing'
import { can, resolvePermissionsForUser } from '#services/permissions'
import { MIN_BOOKING_MINUTES, MAX_BOOKING_MINUTES } from '#services/booking_rules'

/**
 * "Es personal del complejo": ve y gestiona reservas ajenas, en vez de solo las propias.
 *
 * Se deriva del PERMISO y no del nombre del rol, para que un rol creado desde el ABM caiga
 * del lado correcto. Falla cerrado: sin `reservation_management.view` solo ve lo suyo, así
 * que un rol nuevo nunca ve de más por olvido.
 *
 * La propiedad fila-a-fila (ver solo lo propio) sigue viviendo acá y no en el sistema de
 * permisos, que es módulo-acción y no modela pertenencia — ver app/services/permissions.ts.
 */
async function isStaff(user: User): Promise<boolean> {
  return can(await resolvePermissionsForUser(user), 'reservation_management', 'view')
}

/** Puede pasar por encima del corte de "ya pasó" al cancelar o editar. Hoy: solo admin. */
async function canOverridePastCutoff(user: User): Promise<boolean> {
  return can(await resolvePermissionsForUser(user), 'reservation_management', 'erase')
}

/**
 * Puede reservar fuera de la ventana horaria de profesor (`professorStartHour`/
 * `professorEndHour`). Hoy: admin y supervisor.
 *
 * El gate es puramente por permiso — nunca por nombre de rol. Un profesor
 * reservando para sí mismo sigue atado a la ventana porque su rol no tiene el
 * permiso, no porque acá se lo chequee.
 */
async function canOverrideProfessorHours(user: User): Promise<boolean> {
  return can(await resolvePermissionsForUser(user), 'reservation_overrides', 'create')
}
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const CUSTOM_DURATIONS = [150, 180, 210, 240, 270, 300, 330, 360]

const reservationValidator = vine.compile(
  vine.object({
    courtId: vine.number().positive(),
    startTime: vine.string(),
    duration: vine.number().min(MIN_BOOKING_MINUTES).max(MAX_BOOKING_MINUTES),
    contactPhone: vine.string().trim().optional(),
    notes: vine.string().trim().optional(),
    customerId: vine.number().positive().optional(),
    isRecurring: vine.boolean().optional(),
    depositPercentage: vine.number().min(0).max(100).optional(),
    depositFixedAmount: vine.number().min(0).optional().nullable(),
    discountPercentage: vine.number().min(0).max(100).optional(),
    customPrice: vine.number().min(0).optional().nullable(),
    classType: vine.string().optional().nullable(),
  })
)

const editReservationValidator = vine.compile(
  vine.object({
    startTime: vine.string().optional(),
    duration: vine.number().min(MIN_BOOKING_MINUTES).max(MAX_BOOKING_MINUTES).optional(),
    contactPhone: vine.string().trim().optional(),
    notes: vine.string().trim().optional(),
    customerId: vine.number().positive().optional().nullable(),
    isRecurring: vine.boolean().optional(),
    depositPercentage: vine.number().min(0).max(100).optional(),
    depositFixedAmount: vine.number().min(0).optional().nullable(),
    discountPercentage: vine.number().min(0).max(100).optional(),
    customPrice: vine.number().min(0).optional().nullable(),
    courtId: vine.number().positive().optional(),
    classType: vine.string().optional().nullable(),
  })
)

// Calculate price for football courts: hours × pricePerHour
const ART_TZ = 'America/Argentina/Buenos_Aires'

// Set of ART weekdays (1=Mon … 7=Sun) spanned by an inclusive [from, to] ISO range.
// Returns null when the range is open (missing from/to) so callers keep every row.
export function weekdaysInARTRange(from?: string, to?: string): Set<number> | null {
  if (!from || !to) return null
  const fromDT = DateTime.fromISO(from).setZone(ART_TZ).startOf('day')
  const toDT = DateTime.fromISO(to).setZone(ART_TZ).endOf('day')
  const weekdays = new Set<number>()
  for (let d = fromDT; d <= toDT && weekdays.size < 7; d = d.plus({ days: 1 })) {
    weekdays.add(d.weekday)
  }
  return weekdays
}

// Recurring series are stored as a single row and returned regardless of the requested day
// so the frontend (CalendarPage.expandReservations) can expand them into occurrences. Drop
// the ones whose ART weekday can't appear in [from, to] to keep the payload bounded.
// Weekday is resolved in ART, not UTC: a Friday-22:30 fija is stored as Saturday UTC and
// must still match a Friday view.
export function filterRecurringByRange<T extends { isRecurring: boolean; startTime: DateTime }>(
  rows: T[],
  from?: string,
  to?: string
): T[] {
  const weekdays = weekdaysInARTRange(from, to)
  if (!weekdays) return rows
  return rows.filter((r) => !r.isRecurring || weekdays.has(r.startTime.setZone(ART_TZ).weekday))
}

function calculatePrice(
  court: Court,
  priceRanges: CourtPriceRange[],
  start: DateTime,
  end: DateTime
): number {
  return calculateCourtPrice(court, priceRanges, start, end)
}

function applyDiscount(price: number, discountPct: number): number {
  if (!discountPct || discountPct <= 0) return price
  return Math.round(price * (1 - discountPct / 100) * 100) / 100
}

// Returns the price ranges effective for a court at a given date, from history.
// Falls back to current court_price_ranges if no history row exists.
async function getHistoricalRanges(courtId: number, date: DateTime): Promise<CourtPriceRange[]> {
  const dateSQL = date.toUTC().toSQL()!

  const rows = await CourtPriceHistory.query()
    .where('court_id', courtId)
    .where('effective_from', '<=', dateSQL)
    .orderBy('effective_from', 'desc')

  if (rows.length === 0) {
    // Fallback to current ranges (e.g., if history was never written for this court)
    return CourtPriceRange.query().where('court_id', courtId)
  }

  // The most recent effective_from batch wins — group all rows with that same effective_from
  const latestTs = rows[0].effectiveFrom.toSQL()!
  const batch = rows.filter((r) => r.effectiveFrom.toSQL() === latestTs)

  // Cast to CourtPriceRange shape (same columns) so existing calc functions work
  return batch as unknown as CourtPriceRange[]
}

// Returns professor prices effective at a given date, from history.
async function getHistoricalProfessorPrices(
  date: DateTime
): Promise<{ individual: number; group: number; individualWeekend: number }> {
  const dateSQL = date.toUTC().toSQL()!

  const row = await ProfessorPriceHistory.query()
    .where('effective_from', '<=', dateSQL)
    .orderBy('effective_from', 'desc')
    .first()

  if (row) {
    return {
      individual: Number(row.priceIndividual),
      group: Number(row.priceGroup),
      individualWeekend: Number(row.priceIndividualWeekend),
    }
  }

  // Fallback to current settings
  const rows = await Setting.all()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value ?? ''
  return {
    individual: map['professorPriceIndividual'] ? Number(map['professorPriceIndividual']) : 12000,
    group: map['professorPriceGroup'] ? Number(map['professorPriceGroup']) : 15000,
    individualWeekend: map['professorPriceIndividualWeekend']
      ? Number(map['professorPriceIndividualWeekend'])
      : 15000,
  }
}

// Per-request cache to avoid re-fetching the same historical prices when serializing
// many reservations at once (e.g. the paginated listing). Court ranges are keyed by court id
// and professor prices are shared, since every "next occurrence" resolves to the latest batch.
type PriceCache = {
  ranges: Map<number, CourtPriceRange[]>
  prof?: { individual: number; group: number; individualWeekend: number }
}

// Calculate the price for a recurring reservation at a specific occurrence date.
// Returns null if the reservation uses customPrice (caller should use stored value).
// `opts.court` / `opts.targetUser` let callers pass already-preloaded relations to skip queries;
// `opts.cache` memoizes historical lookups across a batch of reservations.
async function calcRecurringOccurrencePrice(
  reservation: Reservation,
  occurrenceDate: DateTime,
  opts: { court?: Court; targetUser?: User | null; cache?: PriceCache; freeGame?: boolean } = {}
): Promise<number | null> {
  // Free-game occurrence is always $0, even for a manual customPrice override — this is the
  // single place that zeroes both the display `occurrencePrice` and the stored `expectedAmount`.
  if (opts.freeGame) return 0
  if (reservation.customPrice != null) return null

  const court = opts.court ?? (await Court.query().where('id', reservation.courtId).firstOrFail())
  const durationMinutes = Math.round(
    reservation.endTime.diff(reservation.startTime, 'minutes').minutes
  )

  // Rebuild start DateTime for this specific occurrence (same time, different date)
  const resStartART = reservation.startTime.setZone(ART_TZ)
  const occurrenceStart = occurrenceDate.setZone(ART_TZ).set({
    hour: resStartART.hour,
    minute: resStartART.minute,
    second: 0,
    millisecond: 0,
  })
  const occurrenceEnd = occurrenceStart.plus({ minutes: durationMinutes })

  const targetUser = 'targetUser' in opts ? opts.targetUser : await User.find(reservation.userId)
  const isProfessor = targetUser?.role === 'professor'

  let price: number

  if (isProfessor) {
    let profPrices = opts.cache?.prof
    if (!profPrices) {
      profPrices = await getHistoricalProfessorPrices(occurrenceStart)
      if (opts.cache) opts.cache.prof = profPrices
    }
    const isWeekend = occurrenceStart.weekday >= 6
    const classType = reservation.classType ?? 'individual'
    if (classType === 'grupal') {
      price = profPrices.group
    } else if (isWeekend) {
      price = profPrices.individualWeekend
    } else {
      price = profPrices.individual
    }
    price = price * (durationMinutes / 60)
  } else {
    let historicalRanges = opts.cache?.ranges.get(reservation.courtId)
    if (!historicalRanges) {
      historicalRanges = await getHistoricalRanges(reservation.courtId, occurrenceStart)
      opts.cache?.ranges.set(reservation.courtId, historicalRanges)
    }
    price = calculatePrice(court, historicalRanges, occurrenceStart, occurrenceEnd)
  }

  return applyDiscount(price, reservation.discountPercentage ?? 0)
}

// Runs an async mapper over items with a bounded number of concurrent operations, so a large
// page never opens more DB connections than the pool can serve (which stalls/times out in prod).
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

// Returns the next occurrence date (ART) for a recurring reservation on or after `from`.
function nextOccurrenceDate(reservation: Reservation, from: DateTime): DateTime {
  const resStartART = reservation.startTime.setZone(ART_TZ)
  const weekday = resStartART.weekday
  let candidate = from.setZone(ART_TZ).startOf('day')
  while (candidate.weekday !== weekday) candidate = candidate.plus({ days: 1 })
  return candidate
}

// Hidden-date-aware "next due" occurrence: like `nextOccurrenceDate`, but skips any
// candidate that is already in the hidden-dates set, landing on the true next playable
// occurrence. Used wherever "next occurrence" needs to account for already-hidden dates
// (promo/price/paid anchor, payment-driven streak increment, hide-time reset check).
function nextDueOccurrence(
  reservation: Reservation,
  from: DateTime,
  hiddenDateStrs: string[]
): DateTime {
  let candidate = nextOccurrenceDate(reservation, from)
  while (hiddenDateStrs.includes(candidate.toISODate()!)) {
    candidate = candidate.plus({ weeks: 1 })
  }
  return candidate
}

// Resolves which occurrence a per-occurrence action targets. An explicit `dateStr` (YYYY-MM-DD in
// ART) wins, so a caller looking at a past occurrence acts on THAT one instead of the next future
// week; it must be a real occurrence of the series (same weekday, on/after the series start, not
// hidden). Callers that don't know the occurrence — the series-level listing, where "next" is the
// intended meaning — omit it and get `nextDueOccurrence`. Invalid input is rejected rather than
// falling back, so a bad date can never be silently charged to the wrong week.
function resolveOccurrenceDate(
  reservation: Reservation,
  dateStr: string | null,
  hiddenDateStrs: string[],
  nowART: DateTime
): { occurrence: DateTime } | { error: string } {
  if (!dateStr) return { occurrence: nextDueOccurrence(reservation, nowART, hiddenDateStrs) }

  const occurrence = DateTime.fromISO(dateStr, { zone: ART_TZ }).startOf('day')
  if (!occurrence.isValid) return { error: 'Fecha de turno inválida' }

  const resStartART = reservation.startTime.setZone(ART_TZ)
  if (occurrence.weekday !== resStartART.weekday) {
    return { error: 'La fecha no corresponde al día de la reserva fija' }
  }
  if (occurrence < resStartART.startOf('day')) {
    return { error: 'La fecha es anterior al inicio de la reserva fija' }
  }
  if (hiddenDateStrs.includes(occurrence.toISODate()!)) {
    return { error: 'Ese turno está oculto' }
  }

  return { occurrence }
}

function timeInMinutes(dt: DateTime): number {
  const art = dt.setZone(ART_TZ)
  return art.hour * 60 + art.minute
}

// Net carry balance for a recurring series: Σ(total − expectedAmount) over its TOTAL payments.
// Negative → the customer owes money (paid less than expected on some occurrence); positive →
// credit (paid more). Payments without expectedAmount (pre-feature) are excluded so they never
// create phantom balances. The balance rolls forward automatically: a hidden occurrence records
// no payment, so it never enters the sum, and the balance simply surfaces on the next charged one.
function computeCarryBalance(r: Reservation): number {
  let saldo = 0
  for (const p of r.payments ?? []) {
    if (p.type !== 'total' || p.expectedAmount == null) continue
    saldo += Number(p.total) - Number(p.expectedAmount)
  }
  return Math.round(saldo * 100) / 100
}

// Returns the effective consecutive games streak, accounting for hidden dates that have
// already passed since the last increment. A past hidden occurrence breaks the streak.
function effectiveConsecutiveGames(r: Reservation, hiddenDateStrs: string[]): number {
  if (!hiddenDateStrs.length) return r.consecutiveGames

  const nowART = DateTime.now().setZone(ART_TZ)
  const resStartART = r.startTime.setZone(ART_TZ)
  const lastIncremented = r.lastIncrementedAt ? r.lastIncrementedAt.setZone(ART_TZ) : null

  // Find the most recent hidden occurrence that is already in the past
  let latestBreaker: DateTime | null = null
  for (const dateStr of hiddenDateStrs) {
    const hdDt = DateTime.fromISO(dateStr, { zone: ART_TZ }).set({
      hour: resStartART.hour,
      minute: resStartART.minute,
      second: 0,
      millisecond: 0,
    })
    // Only counts as a streak breaker if it's in the past
    if (hdDt >= nowART) continue
    // Must be after the last incremented occurrence
    const afterLast = lastIncremented ? hdDt > lastIncremented : hdDt >= resStartART.startOf('day')
    if (!afterLast) continue
    if (!latestBreaker || hdDt > latestBreaker) latestBreaker = hdDt
  }

  if (!latestBreaker) return r.consecutiveGames

  // Streak broke — count non-hidden occurrences from the breaker onward up to now
  let streak = 0
  let cur = latestBreaker.plus({ weeks: 1 })
  while (cur < nowART) {
    const dateStr = cur.toISODate()!
    if (!hiddenDateStrs.includes(dateStr)) streak++
    cur = cur.plus({ weeks: 1 })
  }
  return streak
}

// Returns whether the NEXT occurrence for a recurring reservation is the promo's free game,
// i.e. the effective streak has reached the cycle-boundary position (>= promo.games within
// the games+freeGames cycle). Extracted from the serializer so payTotal/show/index share it.
function isOccurrenceFree(
  r: Reservation,
  promo: { enabled: boolean; games: number; freeGames: number },
  hiddenDateStrs: string[]
): boolean {
  if (!r.isRecurring || !promo.enabled || promo.games <= 0) return false
  const cycle = promo.games + promo.freeGames
  const effectiveGames = effectiveConsecutiveGames(r, hiddenDateStrs)
  const posInCycle = effectiveGames % cycle
  return posInCycle >= promo.games
}

function toDateStr(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val.slice(0, 10)
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  if (val && typeof (val as any).toISODate === 'function') return (val as any).toISODate()
  return null
}

/**
 * Canchas cuyo uso bloquea a `court`: el padre si es una cancha divisible, o todas las
 * hijas si es la cancha completa. Las hermanas NO entran — se alquilan en paralelo.
 * El caller debe traer `court` con `preload('subCourts')`.
 */
function relatedCourtIds(court: Court): number[] {
  const ids: number[] = []
  if (court.parentCourtId) ids.push(court.parentCourtId)
  for (const sc of court.subCourts ?? []) ids.push(sc.id)
  return ids
}

function hasRecurringConflict(
  reservations: Reservation[],
  startTime: DateTime,
  endTime: DateTime
): boolean {
  const startART = startTime.setZone(ART_TZ)
  const endART = endTime.setZone(ART_TZ)
  const startWeekday = startART.weekday
  const startMin = timeInMinutes(startTime)
  const endMin = endART.hour === 0 && endART.minute === 0 ? 24 * 60 : timeInMinutes(endTime)
  const startDateISO = startART.toISODate()!

  for (const r of reservations) {
    const rStartART = r.startTime.setZone(ART_TZ)
    const rEndART = r.endTime.setZone(ART_TZ)
    if (rStartART.weekday !== startWeekday) continue
    const rStartDateISO = rStartART.toISODate()!
    if (startDateISO < rStartDateISO) continue
    const rStartMin = timeInMinutes(r.startTime)
    const rEndMin = rEndART.hour === 0 && rEndART.minute === 0 ? 24 * 60 : timeInMinutes(r.endTime)
    if (startMin >= rEndMin || endMin <= rStartMin) continue
    const hiddenDates = (r.hiddenDates ?? []).map((hd) => toDateStr(hd.hiddenDate))
    if (hiddenDates.includes(startDateISO)) continue
    return true
  }
  return false
}

async function getRecurringPromoSettings(): Promise<{
  enabled: boolean
  games: number
  freeGames: number
}> {
  const rows = await Setting.all()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value ?? ''
  return {
    enabled: map['recurringPromoEnabled'] === 'true',
    games: Number(map['recurringPromoGames'] ?? 0),
    freeGames: Number(map['recurringPromoFreeGames'] ?? 0),
  }
}

async function logReservationChange(
  performedBy: number,
  reservationId: number,
  field: string,
  oldValue: string | null,
  newValue: string | null
) {
  await ReservationAuditLog.create({ performedBy, reservationId, field, oldValue, newValue })
}

// Attaches per-occurrence payment state, promo info (including `isFreeGame`) and the
// current occurrence price to a reservation's serialized object. Shared by `index`'s
// row serializer and by `show`, so both endpoints return the same promo fields (parity).
// `hiddenDateStrs` must already be resolved (flat array of "YYYY-MM-DD" strings).
async function attachPromoFields(
  obj: Record<string, any>,
  r: Reservation,
  promo: { enabled: boolean; games: number; freeGames: number },
  nowART: DateTime,
  hiddenDateStrs: string[],
  cache?: PriceCache
): Promise<void> {
  if (!r.isRecurring) {
    obj.isFreeGame = false
    return
  }

  // Per-occurrence TOTAL payment state for recurring reservations. The series-level
  // `totalPaid` boolean is unreliable across occurrences, so derive each occurrence's
  // paid state from ReservationPayment rows keyed by occurrence_date. The deposit is
  // intentionally NOT per-occurrence — for a fija it's a one-time hold for the series.
  const totalDates: string[] = []
  for (const p of r.payments ?? []) {
    if (p.occurrenceDate && p.type === 'total') totalDates.push(p.occurrenceDate)
  }
  obj.paidOccurrences = totalDates
  const nextDue = nextDueOccurrence(r, nowART, hiddenDateStrs)
  const nextDateStr = nextDue.toISODate()
  obj.totalPaid = nextDateStr != null && totalDates.includes(nextDateStr)
  obj.carryBalance = computeCarryBalance(r)

  const isFree = isOccurrenceFree(r, promo, hiddenDateStrs)
  if (promo.enabled && promo.games > 0) {
    const cycle = promo.games + promo.freeGames
    const effectiveGames = effectiveConsecutiveGames(r, hiddenDateStrs)
    obj.isFreeGame = isFree
    obj.consecutiveGamesDisplay = effectiveGames
    obj.freeGamePosition = promo.games
    obj.promoCycle = cycle
  } else {
    obj.isFreeGame = false
  }

  // Compute the price at the next due occurrence so the UI shows the current price
  // rather than the stale stored one. Zeroed automatically when it's the free game.
  if (r.customPrice == null) {
    try {
      const occurrencePrice = await calcRecurringOccurrencePrice(r, nextDue, {
        court: r.court,
        targetUser: r.user,
        cache,
        freeGame: obj.isFreeGame,
      })
      if (occurrencePrice !== null) {
        obj.occurrencePrice = occurrencePrice
      }
    } catch {
      // If price calc fails, fall back to stored totalPrice — never crash the listing
    }
  }
}

// Serializes a reservation for the listing, attaching per-occurrence payment state, promo
// info and the current occurrence price for recurring rows. Shared by the paginated and
// legacy (array) branches of `index`.
async function serializeReservationRow(
  r: Reservation,
  promo: { enabled: boolean; games: number; freeGames: number },
  nowART: DateTime,
  cache?: PriceCache
): Promise<Record<string, any>> {
  const obj = r.toJSON()
  // Serialize hidden dates as a flat array of date strings
  obj.hiddenDates = (r.hiddenDates ?? []).map((hd) => toDateStr(hd.hiddenDate)).filter(Boolean)

  await attachPromoFields(obj, r, promo, nowART, obj.hiddenDates, cache)

  return obj
}

export default class ReservationsController {
  async index({ auth, request, response }: HttpContext) {
    const user = auth.user!
    // Se resuelve una sola vez: gobierna las tres ramas (summary, paginada y calendario) y
    // decide entre "ve todo" y "ve solo lo suyo".
    const staff = await isStaff(user)
    const from = request.input('from')
    const to = request.input('to')

    if (request.input('summary') === 'true') {
      // start_time + is_recurring are needed to weekday-filter recurring rows; stripped before responding.
      let summaryQuery = Reservation.query().select('id', 'status', 'start_time', 'is_recurring')
      if (!staff) {
        summaryQuery = summaryQuery.where('user_id', user.id)
      }
      // Mirror the main listing: recurring series are date-independent (the `to` bound still applies).
      if (from) {
        const fromSQL = DateTime.fromISO(from).toUTC().toSQL()!
        summaryQuery = summaryQuery.where((q) =>
          q.where('start_time', '>=', fromSQL).orWhere('is_recurring', true)
        )
      }
      if (to)
        summaryQuery = summaryQuery.where('start_time', '<=', DateTime.fromISO(to).toUTC().toSQL()!)
      const rows = filterRecurringByRange(await summaryQuery, from, to)
      return response.ok(rows.map((r) => ({ id: r.id, status: r.status })))
    }

    // Paginated mode — activated only when `page` is present. The reservations list uses this;
    // Calendar (from/to) and Dashboard (summary) omit `page` and still get the full array below.
    // Filtering (status/search/id), sorting and pagination all happen server-side here.
    if (request.input('page') !== undefined) {
      const currentPage = Math.max(1, Number(request.input('page')) || 1)
      const perPage = Math.min(500, Math.max(1, Number(request.input('perPage', 100)) || 100))
      const status = request.input('status')
      const search = String(request.input('search') ?? '').trim()
      const idFilter = request.input('id')

      let pq = Reservation.query()
        .preload('court')
        .preload('user')
        .preload('customer')
        .preload('hiddenDates')
        .preload('payments')

      if (!staff) {
        pq = pq.where('user_id', user.id)
      }
      if (idFilter) {
        pq = pq.where('id', idFilter)
      }
      if (status && status !== 'all' && ['pending', 'confirmed', 'cancelled'].includes(status)) {
        pq = pq.where('status', status)
      }
      // Mirror the frontend client filter: match the client's name/phone or the reservation's
      // contact phone. Only applied when not searching by exact id.
      if (search && !idFilter) {
        const like = `%${search}%`
        pq = pq.where((sub) => {
          sub
            .whereHas('user', (u) => {
              u.where('full_name', 'like', like).orWhere('phone', 'like', like)
            })
            .orWhere('contact_phone', 'like', like)
        })
      }

      // Match the previous client-side ordering: pending → confirmed → cancelled, then newest first.
      pq = pq
        .orderByRaw(
          "CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 1 END"
        )
        .orderBy('start_time', 'desc')

      const paginator = await pq.paginate(currentPage, perPage)

      const promo = await getRecurringPromoSettings()
      const nowART = DateTime.now().setZone(ART_TZ)
      const cache: PriceCache = { ranges: new Map() }
      const data = await mapWithConcurrency(paginator.all(), 8, (r) =>
        serializeReservationRow(r, promo, nowART, cache)
      )

      return response.ok({
        data,
        meta: {
          total: paginator.total,
          perPage: paginator.perPage,
          currentPage: paginator.currentPage,
          lastPage: paginator.lastPage,
        },
      })
    }

    // ── Smart split cache (calendar path) ────────────────────────────────
    // Admin/worker calendar requests (from+to, all data identical across those
    // roles) are split into a frozen past segment and a live present/future one.
    // Past-dated NON-recurring rows are cached 12h; today-onward rows and every
    // recurring series are always served live. Merged back into one array so the
    // response shape is byte-for-byte the same as the generic path below.
    if (from && to && staff) {
      // Force a full DB read (as if no cache key existed) when the client opts out.
      // The fresh past segment is still written back, so this doubles as a refresh.
      const ignoreCache =
        request.input('ignore_cache') === 'true' || request.input('ignore_cache') === true
      const promo = await getRecurringPromoSettings()
      const nowART = DateTime.now().setZone(ART_TZ)
      const todayStartMs = nowART.startOf('day').toMillis()

      const fromDT = DateTime.fromISO(from)
      const toDT = DateTime.fromISO(to)
      const fromMs = fromDT.toMillis()
      const toMs = toDT.toMillis()
      const fromSQL = fromDT.toUTC().toSQL()!
      const toSQL = toDT.toUTC().toSQL()!

      const serializeRows = (rows: Reservation[]) => {
        const cache: PriceCache = { ranges: new Map() }
        return mapWithConcurrency(rows, 8, (r) => serializeReservationRow(r, promo, nowART, cache))
      }

      // Recurring series are date-independent — always live. Preserve the generic
      // path's `start_time <= to` bound (a fija starting after the window is hidden)
      // and the weekday trim.
      const recurringModels = await Reservation.query()
        .preload('court')
        .preload('user')
        .preload('customer')
        .preload('hiddenDates')
        .preload('payments')
        .where('is_recurring', true)
        .where('start_time', '<=', toSQL)
      const recurringRows = await serializeRows(filterRecurringByRange(recurringModels, from, to))

      // Past NON-recurring segment [from, min(to, todayStart)) — cacheable.
      let pastRows: Record<string, any>[] = []
      if (fromMs < todayStartMs) {
        const segToMs = Math.min(toMs, todayStartMs - 1)
        const cached = ignoreCache ? null : reservationCalendarCache.get(fromMs, segToMs)
        if (cached) {
          pastRows = cached
        } else {
          const segToSQL = DateTime.fromMillis(segToMs).toUTC().toSQL()!
          const models = await Reservation.query()
            .preload('court')
            .preload('user')
            .preload('customer')
            .preload('hiddenDates')
            .preload('payments')
            .where('is_recurring', false)
            .where('start_time', '>=', fromSQL)
            .where('start_time', '<=', segToSQL)
          pastRows = await serializeRows(models)
          reservationCalendarCache.set(fromMs, segToMs, pastRows)
        }
      }

      // Live NON-recurring segment [max(from, todayStart), to] — never cached.
      let liveRows: Record<string, any>[] = []
      const liveStartMs = Math.max(fromMs, todayStartMs)
      if (toMs >= liveStartMs) {
        const liveStartSQL = DateTime.fromMillis(liveStartMs).toUTC().toSQL()!
        const models = await Reservation.query()
          .preload('court')
          .preload('user')
          .preload('customer')
          .preload('hiddenDates')
          .preload('payments')
          .where('is_recurring', false)
          .where('start_time', '>=', liveStartSQL)
          .where('start_time', '<=', toSQL)
        liveRows = await serializeRows(models)
      }

      const merged = [...pastRows, ...liveRows, ...recurringRows]
      merged.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      return response.ok(merged)
    }
    // ─────────────────────────────────────────────────────────────────────

    let query = Reservation.query()
      .preload('court')
      .preload('user')
      .preload('customer')
      .preload('hiddenDates')
      .preload('payments')

    if (!staff) {
      query = query.where('user_id', user.id)
    }

    if (from) {
      const fromSQL = DateTime.fromISO(from).toUTC().toSQL()!
      query = query.where((q) => q.where('start_time', '>=', fromSQL).orWhere('is_recurring', true))
    }
    if (to) query = query.where('start_time', '<=', DateTime.fromISO(to).toUTC().toSQL()!)

    const reservations = await query.orderBy('start_time', 'asc')

    // The query returns every recurring series regardless of date. Trim ones whose ART
    // weekday can't fall in the requested window so the response isn't unbounded — the
    // frontend renders nothing for them anyway. Non-recurring rows are already date-bounded.
    const rows = filterRecurringByRange(reservations, from, to)

    // Attach promo info and occurrence price for recurring reservations
    const promo = await getRecurringPromoSettings()
    const nowART = DateTime.now().setZone(ART_TZ)
    const cache: PriceCache = { ranges: new Map() }
    const result = await mapWithConcurrency(rows, 8, (r) =>
      serializeReservationRow(r, promo, nowART, cache)
    )

    return response.ok(result)
  }

  async show({ params, auth, request, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.query()
      .where('id', params.id)
      .preload('court')
      .preload('user')
      .preload('customer')
      .preload('payments')
      .preload('hiddenDates')
      .firstOrFail()

    if (!(await isStaff(user)) && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    const obj = reservation.toJSON()
    obj.hiddenDates = (reservation.hiddenDates ?? [])
      .map((hd) => toDateStr(hd.hiddenDate))
      .filter(Boolean)

    // Attach promo fields (isFreeGame, occurrencePrice, totalPaid, carryBalance) at parity
    // with the index listing — the modal refetches via this endpoint and needs live isFreeGame.
    const promo = await getRecurringPromoSettings()
    const nowART = DateTime.now().setZone(ART_TZ)
    await attachPromoFields(obj, reservation, promo, nowART, obj.hiddenDates)

    // For a recurring reservation, the price effective on each occurrence may differ
    // (e.g. court prices changed over time). When the caller asks about a specific
    // occurrence date, compute the price that was effective on that date rather than
    // the next-due-occurrence value attachPromoFields just set.
    const dateParam = request.input('date')
    if (dateParam && reservation.isRecurring && reservation.customPrice == null) {
      const occurrenceDate = DateTime.fromISO(dateParam, { zone: ART_TZ })
      if (occurrenceDate.isValid) {
        try {
          const isFree = isOccurrenceFree(reservation, promo, obj.hiddenDates)
          const occurrencePrice = await calcRecurringOccurrencePrice(reservation, occurrenceDate, {
            freeGame: isFree,
          })
          if (occurrencePrice !== null) obj.occurrencePrice = occurrencePrice
        } catch {
          // Fall back to stored totalPrice — never fail the request over price calc
        }
      }
    }

    return response.ok(obj)
  }

  async store({ request, auth, response }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(reservationValidator)

    const court = await Court.query()
      .where('id', data.courtId)
      .preload('priceRanges')
      .preload('subCourts')
      .first()

    if (!court) return response.notFound({ message: 'Cancha no encontrada' })
    if (!court.isActive) return response.badRequest({ message: 'La cancha no está disponible' })

    const startTime = DateTime.fromISO(data.startTime)
    const endTime = startTime.plus({ minutes: data.duration })

    const endSQL = endTime.toUTC().toSQL()!
    const startSQL = startTime.toUTC().toSQL()!

    // Validate custom duration for padel (professors only) and football (admin/worker only)
    const isPadelCourt = court.type === 'padel'
    const isFootballCourt = court.type === 'football'
    // Reservar EN NOMBRE DE otro (data.customerId) y fijar precio manual son cosas del
    // personal, así que salen del permiso de gestión y no del nombre del rol.
    const isAdminOrWorker = await isStaff(user)
    const isProfessor = user.role === 'professor'

    // Determine effective customer
    let targetUserId = user.id
    let targetUser = user
    if (isAdminOrWorker && data.customerId) {
      targetUserId = data.customerId
      const cu = await User.find(data.customerId)
      if (cu) targetUser = cu
    }
    const targetIsProfessor = targetUser.role === 'professor'

    // Professor restriction 1 — padel only. Sin excepción: el precio de profesor
    // es tarifa por hora de clase (ver más abajo) y no modela una cancha de fútbol,
    // así que liberarla daría precios incorrectos, no una reserva más flexible.
    if (isProfessor || targetIsProfessor) {
      if (!isPadelCourt) {
        return response.badRequest({
          message: 'Los profesores solo pueden reservar canchas de pádel',
        })
      }
    }

    // Professor restriction 2 — dentro de la ventana horaria configurada, que en la
    // práctica saca a las clases de la franja pico. `reservation_overrides.create`
    // la saltea: antes esta guarda también frenaba al personal, porque dispara con
    // `targetIsProfessor` y no mira quién está reservando.
    if ((isProfessor || targetIsProfessor) && !(await canOverrideProfessorHours(user))) {
      const rows = await Setting.all()
      const cfg: Record<string, string | null> = {}
      for (const r of rows) cfg[r.key] = r.value
      const profStartHour =
        cfg['professorStartHour'] != null ? Number(cfg['professorStartHour']) : 8
      const profEndHour = cfg['professorEndHour'] != null ? Number(cfg['professorEndHour']) : 18
      const startART = startTime.setZone(ART_TZ)
      const endART = endTime.setZone(ART_TZ)
      const startHour = startART.hour + startART.minute / 60
      const endHour = endART.hour + endART.minute / 60
      if (startHour < profStartHour) {
        return response.badRequest({
          message: `Las reservas de profesores deben comenzar desde las ${String(profStartHour).padStart(2, '0')}:00`,
        })
      }
      if (endHour > profEndHour) {
        return response.badRequest({
          message: `Las reservas de profesores deben terminar a las ${String(profEndHour).padStart(2, '0')}:00 o antes`,
        })
      }
    }

    // Validate duration — admins bypass duration restrictions
    if (isPadelCourt && !targetIsProfessor && !isProfessor && !isAdminOrWorker) {
      if (![60, 90, 120].includes(data.duration)) {
        return response.badRequest({ message: 'Duración inválida para cancha de pádel' })
      }
    }
    if (isFootballCourt && !isAdminOrWorker && !CUSTOM_DURATIONS.includes(data.duration)) {
      if (![60, 90, 120].includes(data.duration)) {
        return response.badRequest({ message: 'Duración inválida' })
      }
    }

    // Conflict checks
    const directConflict = await Reservation.query()
      .where('court_id', data.courtId)
      .where('is_recurring', false)
      .whereNot('status', 'cancelled')
      .where('start_time', '<', endSQL)
      .where('end_time', '>', startSQL)
      .first()

    if (directConflict)
      return response.conflict({ message: 'La cancha ya está reservada en ese horario' })

    const recurringOnCourt = await Reservation.query()
      .where('court_id', data.courtId)
      .where('is_recurring', true)
      .whereNot('status', 'cancelled')
      .preload('hiddenDates')

    if (hasRecurringConflict(recurringOnCourt, startTime, endTime)) {
      return response.conflict({
        message: 'La cancha ya está reservada en ese horario (reserva recurrente)',
      })
    }

    // Siblings can be reserved independently — only check parent (if booking a child)
    // or all children (if booking a parent).
    const blockingCourtIds = relatedCourtIds(court)

    if (blockingCourtIds.length > 0) {
      const relatedDirectConflict = await Reservation.query()
        .whereIn('court_id', blockingCourtIds)
        .where('is_recurring', false)
        .whereNot('status', 'cancelled')
        .where('start_time', '<', endSQL)
        .where('end_time', '>', startSQL)
        .first()

      if (relatedDirectConflict) {
        const isParentConflict = relatedDirectConflict.courtId === court.parentCourtId
        return response.conflict({
          message: isParentConflict
            ? 'No se puede reservar: la cancha completa ya está reservada en ese horario'
            : 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas',
        })
      }

      const relatedRecurring = await Reservation.query()
        .whereIn('court_id', blockingCourtIds)
        .where('is_recurring', true)
        .whereNot('status', 'cancelled')
        .preload('hiddenDates')

      if (relatedRecurring.length > 0) {
        const parentRecurring = relatedRecurring.filter((r) => r.courtId === court.parentCourtId)
        const subRecurring = relatedRecurring.filter((r) => r.courtId !== court.parentCourtId)
        if (
          parentRecurring.length > 0 &&
          hasRecurringConflict(parentRecurring, startTime, endTime)
        ) {
          return response.conflict({
            message: 'No se puede reservar: la cancha completa ya está reservada en ese horario',
          })
        }
        if (subRecurring.length > 0 && hasRecurringConflict(subRecurring, startTime, endTime)) {
          return response.conflict({
            message:
              'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas',
          })
        }
      }
    }

    // Precio manual: solo mostrador (`reservation_management`). Que el actor o el cliente
    // sean profesores ya no otorga la autoridad — la clase del profesor se cobra siempre a
    // la tarifa configurada. Se resuelve una sola vez para que el precio efectivo y la
    // columna no puedan divergir: un monto sin autoridad no se cobra NI se persiste, y un
    // customPrice colgado en la columna congelaría el recálculo por ocurrencia de las fijas.
    const manualPrice = isAdminOrWorker ? (data.customPrice ?? null) : null

    // Price calculation
    let totalPrice: number
    if (manualPrice !== null) {
      totalPrice = manualPrice
    } else if (targetIsProfessor || isProfessor) {
      const rows2 = await Setting.all()
      const cfg2: Record<string, string | null> = {}
      for (const r of rows2) cfg2[r.key] = r.value
      const isWeekend = startTime.setZone(ART_TZ).weekday >= 6
      const classType = data.classType ?? 'individual'
      let professorPrice: number
      if (classType === 'grupal') {
        professorPrice =
          cfg2['professorPriceGroup'] != null ? Number(cfg2['professorPriceGroup']) : 15000
      } else if (isWeekend) {
        professorPrice =
          cfg2['professorPriceIndividualWeekend'] != null
            ? Number(cfg2['professorPriceIndividualWeekend'])
            : cfg2['professorPriceIndividual'] != null
              ? Number(cfg2['professorPriceIndividual'])
              : 12000
      } else {
        professorPrice =
          cfg2['professorPriceIndividual'] != null
            ? Number(cfg2['professorPriceIndividual'])
            : 12000
      }
      totalPrice = professorPrice * (data.duration / 60)
    } else {
      totalPrice = calculatePrice(court, court.priceRanges, startTime, endTime)
    }

    const discountPct = data.discountPercentage ?? 0
    totalPrice = applyDiscount(totalPrice, discountPct)

    const reservation = await Reservation.create({
      courtId: data.courtId,
      userId: targetUserId,
      startTime,
      endTime,
      contactPhone: data.contactPhone,
      notes: data.notes,
      totalPrice,
      status: 'pending',
      isRecurring: data.isRecurring ?? false,
      depositPercentage: data.depositPercentage != null ? data.depositPercentage : null,
      depositFixedAmount: data.depositFixedAmount != null ? data.depositFixedAmount : null,
      depositPaid: false,
      totalPaid: false,
      discountPercentage: discountPct,
      consecutiveGames: 0,
      customPrice: manualPrice,
      classType: data.classType ?? null,
    })

    await reservation.load('court')
    await reservation.load('user')

    if (isAdminOrWorker) {
      await logReservationChange(user.id, reservation.id, 'created', null, 'pending')
    }

    // Drop any cached past window covering this date (admin can backdate reservations).
    reservationCalendarCache.invalidateFor(reservation.startTime)

    return response.created(reservation)
  }

  async update({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.findOrFail(params.id)
    // Capture the pre-edit instant so we can invalidate the cache window it was in,
    // even if the edit moves the reservation to a different date.
    const originalStartTime = reservation.startTime

    // Solo el personal edita reservas ajenas; el profesor gestiona las suyas. Cualquier otro
    // rol —cliente, o uno creado desde el ABM sin permisos de gestión— no edita nada.
    const staff = await isStaff(user)
    if (!staff && user.role !== 'professor') {
      return response.forbidden({ message: 'Sin permisos para modificar reservas' })
    }
    if (!staff && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    const isAdminOrWorker = staff

    // Status-only update (confirm/cancel)
    const status = request.input('status')
    if (status && ['pending', 'confirmed', 'cancelled'].includes(status) && isAdminOrWorker) {
      // Past reservations can only be cancelled by an admin (workers are limited to upcoming ones)
      const isPast = !reservation.isRecurring && reservation.endTime < DateTime.now()
      if (status === 'cancelled' && isPast && !(await canOverridePastCutoff(user))) {
        return response.forbidden({
          message: 'Solo un administrador puede cancelar una reserva pasada',
        })
      }

      const oldStatus = reservation.status
      reservation.status = status
      if (status === 'confirmed' && !reservation.confirmedAt) {
        reservation.confirmedAt = DateTime.now()
        reservation.confirmedBy = user.id
      }
      if (status === 'cancelled' && !reservation.cancelledAt) {
        reservation.cancelledAt = DateTime.now()
        reservation.cancelledBy = user.id
      }
      await reservation.save()
      await logReservationChange(user.id, reservation.id, 'status', oldStatus, status)
      reservationCalendarCache.invalidateFor(reservation.startTime)
      return response.ok(reservation)
    }

    // Full edit — only admin/worker can edit any reservation
    if (!isAdminOrWorker) {
      if (reservation.status !== 'pending') {
        return response.badRequest({ message: 'Solo se pueden modificar reservas pendientes' })
      }
    }

    // Block editing past reservations (non-recurring only); super users bypass this
    if (!user.isSuperUser && !reservation.isRecurring && reservation.endTime < DateTime.now()) {
      return response.badRequest({ message: 'No se puede editar una reserva que ya ocurrió' })
    }

    const data = await request.validateUsing(editReservationValidator)

    const courtId = data.courtId ?? reservation.courtId
    const court = await Court.query()
      .where('id', courtId)
      .preload('priceRanges')
      .preload('subCourts')
      .firstOrFail()

    const startTime = data.startTime ? DateTime.fromISO(data.startTime) : reservation.startTime
    const currentDurationMin = Math.round(
      reservation.endTime.diff(reservation.startTime, 'minutes').minutes
    )
    const duration = data.duration ?? currentDurationMin
    const endTime = startTime.plus({ minutes: duration })

    // Conflict checks (skip for recurring reservations being edited)
    if (!reservation.isRecurring) {
      const endSQLc = endTime.toUTC().toSQL()!
      const startSQLc = startTime.toUTC().toSQL()!

      const directConflict = await Reservation.query()
        .where('court_id', courtId)
        .whereNot('id', reservation.id)
        .where('is_recurring', false)
        .whereNot('status', 'cancelled')
        .where('start_time', '<', endSQLc)
        .where('end_time', '>', startSQLc)
        .first()

      if (directConflict)
        return response.conflict({ message: 'La cancha ya está reservada en ese horario' })

      const recurringOnCourt = await Reservation.query()
        .where('court_id', courtId)
        .whereNot('id', reservation.id)
        .where('is_recurring', true)
        .whereNot('status', 'cancelled')
        .preload('hiddenDates')

      if (hasRecurringConflict(recurringOnCourt, startTime, endTime)) {
        return response.conflict({
          message: 'La cancha ya está reservada en ese horario (reserva recurrente)',
        })
      }

      const blockingCourtIds = relatedCourtIds(court)

      if (blockingCourtIds.length > 0) {
        const relatedDirectConflict = await Reservation.query()
          .whereIn('court_id', blockingCourtIds)
          .where('is_recurring', false)
          .whereNot('status', 'cancelled')
          .where('start_time', '<', endSQLc)
          .where('end_time', '>', startSQLc)
          .first()

        if (relatedDirectConflict) {
          const isParentConflict = relatedDirectConflict.courtId === court.parentCourtId
          return response.conflict({
            message: isParentConflict
              ? 'No se puede reservar: la cancha completa ya está reservada en ese horario'
              : 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas',
          })
        }

        const relatedRecurring = await Reservation.query()
          .whereIn('court_id', blockingCourtIds)
          .where('is_recurring', true)
          .whereNot('status', 'cancelled')
          .preload('hiddenDates')

        if (relatedRecurring.length > 0) {
          const parentRecurring = relatedRecurring.filter((r) => r.courtId === court.parentCourtId)
          const subRecurring = relatedRecurring.filter((r) => r.courtId !== court.parentCourtId)
          if (
            parentRecurring.length > 0 &&
            hasRecurringConflict(parentRecurring, startTime, endTime)
          ) {
            return response.conflict({
              message: 'No se puede reservar: la cancha completa ya está reservada en ese horario',
            })
          }
          if (subRecurring.length > 0 && hasRecurringConflict(subRecurring, startTime, endTime)) {
            return response.conflict({
              message:
                'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas',
            })
          }
        }
      }
    }

    // Determine target user role for price calculation
    const targetUser = await User.find(reservation.userId)
    const targetIsProfessor = targetUser?.role === 'professor'

    // Un no-staff (el profesor sobre sus propias filas) no puede fijar ni borrar el
    // precio manual: se preserva el que el mostrador dejó en la fila, y sigue
    // gobernando totalPrice para que la fila no quede incoherente.
    const effectiveCustomPrice: number | null = isAdminOrWorker
      ? data.customPrice !== undefined
        ? data.customPrice
        : reservation.customPrice
      : reservation.customPrice

    // Price recalc
    let totalPrice: number
    if (effectiveCustomPrice !== null) {
      totalPrice = effectiveCustomPrice
    } else if (targetIsProfessor) {
      const rows2 = await Setting.all()
      const cfg2: Record<string, string | null> = {}
      for (const r of rows2) cfg2[r.key] = r.value
      const isWeekend = startTime.setZone(ART_TZ).weekday >= 6
      const classType = data.classType ?? reservation.classType ?? 'individual'
      let professorPrice: number
      if (classType === 'grupal') {
        professorPrice =
          cfg2['professorPriceGroup'] != null ? Number(cfg2['professorPriceGroup']) : 15000
      } else if (isWeekend) {
        professorPrice =
          cfg2['professorPriceIndividualWeekend'] != null
            ? Number(cfg2['professorPriceIndividualWeekend'])
            : cfg2['professorPriceIndividual'] != null
              ? Number(cfg2['professorPriceIndividual'])
              : 12000
      } else {
        professorPrice =
          cfg2['professorPriceIndividual'] != null
            ? Number(cfg2['professorPriceIndividual'])
            : 12000
      }
      totalPrice = professorPrice * (duration / 60)
    } else {
      totalPrice = calculatePrice(court, court.priceRanges, startTime, endTime)
    }
    const discountPct = data.discountPercentage ?? reservation.discountPercentage ?? 0
    totalPrice = applyDiscount(totalPrice, discountPct)

    // Build audit log
    const auditFields: Record<string, { old: string | null; new: string | null }> = {}

    if (data.startTime && reservation.startTime.toUTC().toISO() !== startTime.toUTC().toISO()) {
      auditFields['startTime'] = {
        old: reservation.startTime.toUTC().toISO(),
        new: startTime.toUTC().toISO(),
      }
    }
    if (data.duration !== undefined && duration !== currentDurationMin) {
      auditFields['duration'] = { old: String(currentDurationMin), new: String(duration) }
    }
    if (data.courtId !== undefined && data.courtId !== reservation.courtId) {
      auditFields['courtId'] = { old: String(reservation.courtId), new: String(data.courtId) }
    }
    if (effectiveCustomPrice !== reservation.customPrice) {
      auditFields['customPrice'] = {
        old: String(reservation.customPrice ?? ''),
        new: String(effectiveCustomPrice ?? ''),
      }
    }
    if (
      data.discountPercentage !== undefined &&
      Number(data.discountPercentage) !== Number(reservation.discountPercentage ?? 0)
    ) {
      auditFields['discountPercentage'] = {
        old: String(reservation.discountPercentage ?? 0),
        new: String(data.discountPercentage),
      }
    }
    if (data.notes !== undefined && data.notes !== reservation.notes) {
      auditFields['notes'] = { old: reservation.notes, new: data.notes }
    }
    if (data.contactPhone !== undefined && data.contactPhone !== reservation.contactPhone) {
      auditFields['contactPhone'] = { old: reservation.contactPhone, new: data.contactPhone }
    }
    if (data.isRecurring !== undefined && data.isRecurring !== reservation.isRecurring) {
      auditFields['isRecurring'] = {
        old: String(reservation.isRecurring),
        new: String(data.isRecurring),
      }
    }
    if (
      data.depositPercentage !== undefined &&
      Number(data.depositPercentage) !== Number(reservation.depositPercentage ?? 0)
    ) {
      auditFields['depositPercentage'] = {
        old: String(reservation.depositPercentage ?? ''),
        new: String(data.depositPercentage),
      }
    }
    if (
      data.depositFixedAmount !== undefined &&
      Number(data.depositFixedAmount ?? 0) !== Number(reservation.depositFixedAmount ?? 0)
    ) {
      auditFields['depositFixedAmount'] = {
        old: String(reservation.depositFixedAmount ?? ''),
        new: String(data.depositFixedAmount ?? ''),
      }
    }
    if (data.customerId !== undefined && data.customerId !== reservation.userId) {
      auditFields['userId'] = { old: String(reservation.userId), new: String(data.customerId) }
    }

    // Apply new total price audit if changed
    if (Math.abs(totalPrice - Number(reservation.totalPrice)) > 0.001) {
      auditFields['totalPrice'] = { old: String(reservation.totalPrice), new: String(totalPrice) }
    }
    if (data.classType !== undefined && data.classType !== reservation.classType) {
      auditFields['classType'] = { old: reservation.classType ?? '', new: data.classType ?? '' }
    }

    reservation.merge({
      courtId,
      startTime,
      endTime,
      totalPrice,
      discountPercentage: discountPct,
      customPrice: effectiveCustomPrice,
      classType: data.classType !== undefined ? data.classType : reservation.classType,
      contactPhone: data.contactPhone !== undefined ? data.contactPhone : reservation.contactPhone,
      notes: data.notes !== undefined ? data.notes : reservation.notes,
      isRecurring: data.isRecurring !== undefined ? data.isRecurring : reservation.isRecurring,
      depositPercentage:
        data.depositPercentage !== undefined
          ? data.depositPercentage
          : reservation.depositPercentage,
      depositFixedAmount:
        data.depositFixedAmount !== undefined
          ? data.depositFixedAmount
          : reservation.depositFixedAmount,
    })

    if (data.customerId !== undefined) {
      reservation.userId = data.customerId ?? reservation.userId
    }

    await reservation.save()

    for (const [field, vals] of Object.entries(auditFields)) {
      await logReservationChange(user.id, reservation.id, field, vals.old, vals.new)
    }

    // Invalidate both the old and new date windows (the edit may have moved it).
    reservationCalendarCache.invalidateFor(originalStartTime)
    reservationCalendarCache.invalidateFor(reservation.startTime)

    return response.ok(reservation)
  }

  async destroy({ params, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.findOrFail(params.id)

    // Propiedad. Antes esto solo se comprobaba para `customer`, así que un profesor podía
    // cancelar la reserva de CUALQUIER otro usuario. Sin permisos de gestión: solo la propia.
    const staff = await isStaff(user)
    if (!staff && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    if (reservation.status === 'confirmed' && !staff && user.role === 'customer') {
      return response.forbidden({
        message: 'Las reservas confirmadas solo pueden cancelarlas admin o empleados',
      })
    }

    // Una reserva pasada solo la cancela quien puede pasar por encima del corte (hoy: admin).
    const isPast = !reservation.isRecurring && reservation.endTime < DateTime.now()
    if (isPast && !(await canOverridePastCutoff(user))) {
      return response.forbidden({
        message: 'Solo un administrador puede cancelar una reserva pasada',
      })
    }

    const oldStatus = reservation.status
    reservation.status = 'cancelled'
    if (!reservation.cancelledAt) {
      reservation.cancelledAt = DateTime.now()
      reservation.cancelledBy = user.id
    }
    await reservation.save()
    await logReservationChange(user.id, reservation.id, 'status', oldStatus, 'cancelled')
    reservationCalendarCache.invalidateFor(reservation.startTime)
    return response.ok({ message: 'Reserva cancelada correctamente' })
  }

  async hideNext({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    // Acceso por permiso en la ruta (reservation_management / payments), no por nombre de rol.

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring)
      return response.badRequest({ message: 'La reserva no es recurrente' })

    // Hidden dates that existed BEFORE this hide, used to resolve the true next-due
    // occurrence (hidden-date-aware) — the newly hidden date itself must NOT count yet.
    await reservation.load('hiddenDates')
    const existingHiddenStrs = (reservation.hiddenDates ?? [])
      .map((hd) => toDateStr(hd.hiddenDate))
      .filter((v): v is string => v != null)

    const dateParam = request.input('date') // YYYY-MM-DD of the specific occurrence to hide
    let targetDateStr: string

    if (dateParam) {
      targetDateStr = dateParam
    } else {
      const startWeekday = reservation.startTime.setZone(ART_TZ).weekday
      let next = DateTime.now().setZone(ART_TZ).startOf('day').plus({ days: 1 })
      while (next.weekday !== startWeekday) next = next.plus({ days: 1 })
      targetDateStr = next.toISODate()!
    }

    // Reset-on-hide: hiding the immediate next-due occurrence resets the streak to 0,
    // always (paid or not). Farther-future hides never touch it (spec: "Reset Streak Only
    // on Next-Due Hide"). "Next-due" skips dates already hidden before this one.
    const nowART = DateTime.now().setZone(ART_TZ)
    const nextDue = nextDueOccurrence(reservation, nowART, existingHiddenStrs)
    const isNextDue = nextDue.toISODate() === targetDateStr

    // Insert into pivot table (ignore duplicate)
    await ReservationHiddenDate.updateOrCreate(
      { reservationId: reservation.id, hiddenDate: targetDateStr },
      { reservationId: reservation.id, hiddenDate: targetDateStr }
    )

    if (isNextDue) {
      reservation.consecutiveGames = 0
      reservation.lastIncrementedAt = null
      await reservation.save()
    }

    await logReservationChange(user.id, reservation.id, 'hiddenDate', null, targetDateStr)

    await reservation.load('hiddenDates')
    const obj = reservation.toJSON()
    obj.hiddenDates = (reservation.hiddenDates ?? [])
      .map((hd) => toDateStr(hd.hiddenDate))
      .filter(Boolean)
    return response.ok(obj)
  }

  async payDeposit(ctx: HttpContext) {
    const { params, request, auth, response } = ctx
    const user = auth.user!
    // Acceso por permiso en la ruta (reservation_management / payments), no por nombre de rol.

    const reservation = await Reservation.findOrFail(params.id)
    // The deposit is a one-time hold per series (also for fijas), so the guard stays series-level.
    if (reservation.depositPaid)
      return response.badRequest({ message: 'La seña ya fue registrada' })

    // For recurring reservations, record which occurrence the deposit was taken against.
    let occurrenceDate: string | null = null
    if (reservation.isRecurring) {
      const nowART = DateTime.now().setZone(ART_TZ)
      occurrenceDate = nextOccurrenceDate(reservation, nowART).toISODate()
    }

    const receipt = request.input('receipt', null)
    const efectivo = Number(request.input('efectivo', 0)) || 0
    const transferencia = Number(request.input('transferencia', 0)) || 0
    const postnet = Number(request.input('postnet', 0)) || 0
    const payTotal = Math.round((efectivo + transferencia + postnet) * 100) / 100

    const oldStatus = reservation.status
    reservation.depositPaid = true
    reservation.depositPaidAt = DateTime.now()
    reservation.depositPaidBy = user.id
    reservation.status = 'confirmed'
    if (!reservation.confirmedAt) {
      reservation.confirmedAt = DateTime.now()
      reservation.confirmedBy = user.id
    }
    if (receipt) reservation.depositReceipt = receipt
    await reservation.save()

    // Record payment breakdown
    await ReservationPayment.create({
      reservationId: reservation.id,
      // El turno de caja en que entró la plata. middleware.cashRegister ya garantizó que
      // hay una sesión abierta; esto la estampa en la fila para que el arqueo no dependa
      // de comparar timestamps. Ver la migración 1784000000005.
      cashSessionId: await currentCashSessionId(ctx),
      type: 'deposit',
      efectivo,
      transferencia,
      postnet,
      total: payTotal,
      paidBy: user.id,
      receipt: receipt || null,
      occurrenceDate,
    })

    const depositWord = reservation.isRecurring ? 'Depósito' : 'Seña'
    const auditNote = occurrenceDate ? `$${payTotal} (${occurrenceDate})` : `$${payTotal}`
    await logReservationChange(
      user.id,
      reservation.id,
      'depositPayment',
      null,
      `${depositWord}: ${auditNote}`
    )

    if (oldStatus !== 'confirmed') {
      await logReservationChange(user.id, reservation.id, 'status', oldStatus, 'confirmed')
    }
    reservationCalendarCache.invalidateFor(reservation.startTime)
    return response.ok(reservation)
  }

  async payTotal(ctx: HttpContext) {
    const { params, request, auth, response } = ctx
    const user = auth.user!
    // Acceso por permiso en la ruta (reservation_management / payments), no por nombre de rol.

    const reservation = await Reservation.findOrFail(params.id)

    // For recurring reservations, payment is tracked per occurrence date, and we freeze the
    // base price expected for that occurrence so the series carry balance can be derived.
    // The caller sends `occurrence_date` when it knows which week is being paid (the calendar
    // shows one expanded occurrence at a time); without it we fall back to the next due one.
    // The promo cycle position is resolved once here so both the expected amount and the streak
    // increment below agree on whether this is the free game.
    let occurrenceDate: string | null = null
    let expectedAmount: number | null = null
    let occurrenceStartART: DateTime | null = null
    let hiddenStrs: string[] = []
    let isFree = false
    if (reservation.isRecurring) {
      await reservation.load('hiddenDates')
      hiddenStrs = (reservation.hiddenDates ?? [])
        .map((hd) => toDateStr(hd.hiddenDate))
        .filter((v): v is string => v != null)

      const nowART = DateTime.now().setZone(ART_TZ)
      const requestedDate = request.input('occurrence_date', null)
      const resolved = resolveOccurrenceDate(reservation, requestedDate, hiddenStrs, nowART)
      if ('error' in resolved) return response.badRequest({ message: resolved.error })
      const targetOcc = resolved.occurrence
      occurrenceDate = targetOcc.toISODate()

      const resStartART = reservation.startTime.setZone(ART_TZ)
      occurrenceStartART = targetOcc.setZone(ART_TZ).set({
        hour: resStartART.hour,
        minute: resStartART.minute,
        second: 0,
        millisecond: 0,
      })

      const promo = await getRecurringPromoSettings()
      isFree = isOccurrenceFree(reservation, promo, hiddenStrs)
      expectedAmount = isFree
        ? 0
        : ((await calcRecurringOccurrencePrice(reservation, targetOcc)) ??
          Number(reservation.totalPrice))
    }

    // For reservations with a deposit requirement, the (one-time, series-level) deposit must be
    // paid first. For recurring reservations without a deposit set, allow direct payment.
    const hasDepositRequirement =
      reservation.depositPercentage != null || reservation.depositFixedAmount != null
    if (hasDepositRequirement && !reservation.depositPaid) {
      return response.badRequest({
        message: reservation.isRecurring
          ? 'Primero debe registrarse el depósito'
          : 'Primero debe registrarse el pago de la seña',
      })
    }

    // Already-paid guard: per occurrence for recurring, per series otherwise.
    if (reservation.isRecurring) {
      // whereNull('reverted_at'): si el pago de este turno se revirtió, la ocurrencia
      // vuelve a estar impaga y hay que poder cobrarla de nuevo.
      const existing = await ReservationPayment.query()
        .where('reservation_id', reservation.id)
        .where('type', 'total')
        .where('occurrence_date', occurrenceDate!)
        .whereNull('reverted_at')
        .first()
      if (existing)
        return response.badRequest({ message: 'El pago de este turno ya fue registrado' })
    } else if (reservation.totalPaid) {
      return response.badRequest({ message: 'El pago total ya fue registrado' })
    }

    const receipt = request.input('receipt', null)
    const efectivo = Number(request.input('efectivo', 0)) || 0
    const transferencia = Number(request.input('transferencia', 0)) || 0
    const postnet = Number(request.input('postnet', 0)) || 0
    const payTotal = Math.round((efectivo + transferencia + postnet) * 100) / 100

    reservation.totalPaid = true
    reservation.totalPaidAt = DateTime.now()
    reservation.totalPaidBy = user.id
    reservation.totalPaidCount = (reservation.totalPaidCount || 0) + 1
    if (receipt) reservation.totalReceipt = receipt

    // Payment-driven loyalty streak: TOTAL payment is the single source of truth for
    // `consecutiveGames`. This site is guarded by the per-occurrence ReservationPayment
    // check right above, so it executes exactly once per occurrence (idempotent by
    // construction — no separate guard needed). Ported from the deleted `incrementGames`:
    // a hidden occurrence strictly between the last increment and the one being paid now
    // breaks the streak before the +1 is applied.
    if (reservation.isRecurring && occurrenceStartART) {
      const resStartART = reservation.startTime.setZone(ART_TZ)
      const lastIncremented = reservation.lastIncrementedAt
      const streakBroken = hiddenStrs.some((dateStr) => {
        const hdDt = DateTime.fromISO(dateStr, { zone: ART_TZ }).set({
          hour: resStartART.hour,
          minute: resStartART.minute,
          second: 0,
          millisecond: 0,
        })
        const afterLast = lastIncremented
          ? hdDt > lastIncremented
          : hdDt >= resStartART.startOf('day')
        return afterLast && hdDt < occurrenceStartART!
      })

      if (streakBroken) reservation.consecutiveGames = 0
      reservation.consecutiveGames += 1
      // The anchor only moves forward. Paying a late occurrence must not rewind it, or
      // `effectiveConsecutiveGames` would re-count hidden dates the streak already consumed.
      // The +1 above still applies — it is guarded by the per-occurrence payment check.
      if (!reservation.lastIncrementedAt || occurrenceStartART > reservation.lastIncrementedAt) {
        reservation.lastIncrementedAt = occurrenceStartART
      }

      // Auto-reset after completing the free game(s) in this cycle.
      const promo = await getRecurringPromoSettings()
      if (promo.enabled && promo.games > 0 && promo.freeGames > 0) {
        const cycle = promo.games + promo.freeGames
        if (reservation.consecutiveGames >= cycle) {
          reservation.consecutiveGames = 0
        }
      }
    }

    await reservation.save()

    // Record payment breakdown
    await ReservationPayment.create({
      reservationId: reservation.id,
      cashSessionId: await currentCashSessionId(ctx),
      type: 'total',
      efectivo,
      transferencia,
      postnet,
      total: payTotal,
      paidBy: user.id,
      receipt: receipt || null,
      occurrenceDate,
      expectedAmount,
    })

    const auditNote = occurrenceDate ? `$${payTotal} (${occurrenceDate})` : `$${payTotal}`
    await logReservationChange(user.id, reservation.id, 'totalPayment', null, `Pago: ${auditNote}`)

    reservationCalendarCache.invalidateFor(reservation.startTime)
    return response.ok(reservation)
  }

  async availability({ request, response }: HttpContext) {
    const courtId = request.input('court_id')
    const date = request.input('date')
    if (!courtId || !date) return response.badRequest({ message: 'Se requiere court_id y date' })

    const queryDate = DateTime.fromISO(date, { zone: ART_TZ })
    const start = queryDate.startOf('day')
    const end = queryDate.endOf('day')
    const queryWeekday = queryDate.weekday
    const queryDateStr = queryDate.toISODate()!

    const court = await Court.query().where('id', courtId).preload('subCourts').first()
    if (!court) return response.notFound({ message: 'Cancha no encontrada' })

    // A recurring series only occupies the queried day when it falls on the same ART
    // weekday and that specific occurrence has not been hidden.
    const occursOnQueryDate = (r: Reservation) => {
      if (r.startTime.setZone(ART_TZ).weekday !== queryWeekday) return false
      const hiddenDates = (r.hiddenDates ?? []).map((hd) => toDateStr(hd.hiddenDate))
      return !hiddenDates.includes(queryDateStr)
    }

    const dayReservations = (ids: number[]) =>
      Reservation.query()
        .whereIn('court_id', ids)
        .whereNot('status', 'cancelled')
        .where('is_recurring', false)
        .where('start_time', '>=', start.toUTC().toSQL()!)
        .where('start_time', '<=', end.toUTC().toSQL()!)
        .orderBy('start_time', 'asc')

    const recurringReservations = (ids: number[]) =>
      Reservation.query()
        .whereIn('court_id', ids)
        .whereNot('status', 'cancelled')
        .where('is_recurring', true)
        .where('start_time', '<=', end.toUTC().toSQL()!)
        .preload('hiddenDates')

    // This route is public (`start/routes.ts`, outside `middleware.auth()`), and answering
    // "is this slot taken?" only needs the span. Who booked it, what they wrote in the
    // notes and what they paid are none of an anonymous caller's business, so every row
    // is projected down to the fields the booking grids actually read.
    const asSlot = (r: Reservation) => ({
      id: r.id,
      courtId: r.courtId,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status,
      isRecurring: r.isRecurring,
    })

    // Reserving the whole field blocks every sub-court and vice versa, so the grid must
    // show those slots as taken — otherwise the caller only finds out at store() time,
    // which already rejects the overlap with a 409.
    const courtIds = [court.id, ...relatedCourtIds(court)]

    const direct = await dayReservations(courtIds)
    const recurringSeries = await recurringReservations(courtIds)
    const recurring = recurringSeries.filter(occursOnQueryDate)

    return response.ok([...direct, ...recurring].map(asSlot))
  }

  async showNext({ params, request, response }: HttpContext) {
    // Acceso: `reservation_management.update` en la ruta, no por nombre de rol.
    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring)
      return response.badRequest({ message: 'La reserva no es recurrente' })

    const dateParam = request.input('date') // YYYY-MM-DD of the specific occurrence to show

    if (dateParam) {
      // Remove only this specific hidden date from the pivot table
      await ReservationHiddenDate.query()
        .where('reservation_id', reservation.id)
        .where('hidden_date', dateParam)
        .delete()
    } else {
      // Legacy: remove all hidden dates (clear everything)
      await ReservationHiddenDate.query().where('reservation_id', reservation.id).delete()
    }

    await reservation.load('hiddenDates')
    const obj = reservation.toJSON()
    obj.hiddenDates = (reservation.hiddenDates ?? [])
      .map((hd) => toDateStr(hd.hiddenDate))
      .filter(Boolean)
    return response.ok(obj)
  }

  async auditLogs({ params, response }: HttpContext) {
    // Acceso: `reservation_management.view` en la ruta.

    const logs = await ReservationAuditLog.query()
      .where('reservation_id', params.id)
      .preload('performer', (q) => q.select('id', 'full_name', 'email'))
      .orderBy('created_at', 'desc')

    return response.ok(logs)
  }

  async revert({ params, auth, response }: HttpContext) {
    // Acceso: `reservation_management.erase` en la ruta.
    const user = auth.user!

    const reservation = await Reservation.findOrFail(params.id)
    if (reservation.status !== 'cancelled')
      return response.badRequest({ message: 'Solo se pueden revertir reservas canceladas' })

    reservation.status = 'pending'
    reservation.cancelledAt = null
    reservation.cancelledBy = null
    await reservation.save()
    await logReservationChange(user.id, reservation.id, 'status', 'cancelled', 'pending')
    reservationCalendarCache.invalidateFor(reservation.startTime)

    return response.ok(reservation)
  }

  async revertPayment(ctx: HttpContext) {
    const { params, auth, response } = ctx
    // Acceso: `payments.erase` en la ruta.
    const user = auth.user!

    const reservation = await Reservation.findOrFail(params.id)
    const payment = await ReservationPayment.findOrFail(params.paymentId)

    if (payment.reservationId !== reservation.id) {
      return response.badRequest({ message: 'El pago no pertenece a esta reserva' })
    }

    // Revertir dos veces descontaría totalPaidCount dos veces por un solo pago, y le
    // cargaría al turno actual una salida de plata que ya salió.
    if (payment.revertedAt) {
      return response.badRequest({ message: 'El pago ya fue revertido' })
    }

    const auditOld = JSON.stringify({
      type: payment.type,
      total: payment.total,
      efectivo: payment.efectivo,
      transferencia: payment.transferencia,
      postnet: payment.postnet,
      occurrenceDate: payment.occurrenceDate ?? undefined,
    })

    // Se anula, no se borra: la fila es lo que le permite al cierre de caja imputar la
    // salida de plata al turno en que se revirtió.
    payment.revertedAt = DateTime.now()
    payment.revertedBy = user.id
    // El turno en que SALE la plata, que no es el turno en que entró. De ahí que sean
    // dos columnas distintas y no una.
    payment.revertedInCashSessionId = await currentCashSessionId(ctx)
    await payment.save()

    if (payment.type === 'deposit') {
      reservation.depositPaid = false
      reservation.depositPaidAt = null
      reservation.depositPaidBy = null
      reservation.depositReceipt = null
    } else {
      const newCount = Math.max((reservation.totalPaidCount ?? 1) - 1, 0)
      reservation.totalPaidCount = newCount
      if (newCount === 0) {
        reservation.totalPaid = false
        reservation.totalPaidAt = null
        reservation.totalPaidBy = null
        reservation.totalReceipt = null
      }
    }

    await reservation.save()
    await logReservationChange(user.id, reservation.id, 'paymentReverted', auditOld, null)
    reservationCalendarCache.invalidateFor(reservation.startTime)

    await reservation.load('payments')
    return response.ok(reservation)
  }

  async revertAllPayments(ctx: HttpContext) {
    const { params, auth, response } = ctx
    // Acceso: `payments.erase` en la ruta.
    const user = auth.user!

    const reservation = await Reservation.findOrFail(params.id)
    // Solo los vigentes: los ya revertidos no se vuelven a revertir ni entran en el
    // snapshot de auditoría, que si no repetiría pagos ya dados de baja antes.
    const payments = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .whereNull('reverted_at')

    if (payments.length === 0)
      return response.badRequest({ message: 'No hay pagos registrados para esta reserva' })

    const auditSummary = JSON.stringify(
      payments.map((p) => ({
        type: p.type,
        total: p.total,
        efectivo: p.efectivo,
        transferencia: p.transferencia,
        postnet: p.postnet,
        occurrenceDate: p.occurrenceDate ?? undefined,
      }))
    )

    await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .whereNull('reverted_at')
      .update({
        reverted_at: DateTime.now().toSQL({ includeOffset: false }),
        reverted_by: user.id,
        reverted_in_cash_session_id: await currentCashSessionId(ctx),
      })

    reservation.depositPaid = false
    reservation.depositPaidAt = null
    reservation.depositPaidBy = null
    reservation.depositReceipt = null
    reservation.totalPaid = false
    reservation.totalPaidAt = null
    reservation.totalPaidBy = null
    reservation.totalReceipt = null
    reservation.totalPaidCount = 0

    await reservation.save()
    await logReservationChange(user.id, reservation.id, 'allPaymentsReverted', auditSummary, null)
    reservationCalendarCache.invalidateFor(reservation.startTime)

    await reservation.load('payments')
    return response.ok(reservation)
  }

  async auditLogsAll({ request, response }: HttpContext) {
    // Acceso: `audit.view` en la ruta.

    const currentPage = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(200, Math.max(1, Number(request.input('perPage', 50)) || 50))
    const performedBy = Number(request.input('performedBy')) || 0
    const reservationId = Number(request.input('reservationId')) || 0
    const courtId = Number(request.input('courtId')) || 0
    const date = String(request.input('date') ?? '').trim()

    let q = ReservationAuditLog.query()
      .preload('performer', (p) => p.select('id', 'full_name', 'email', 'role'))
      .preload('reservation', (r) => r.preload('court', (c) => c.select('id', 'name')))
      .orderBy('created_at', 'desc')

    if (performedBy) q = q.where('performed_by', performedBy)
    if (reservationId) q = q.where('reservation_id', reservationId)
    if (courtId) q = q.whereHas('reservation', (r) => r.where('court_id', courtId))
    if (date) {
      const day = DateTime.fromISO(date, { zone: ART_TZ })
      if (day.isValid) {
        q = q
          .where('created_at', '>=', day.startOf('day').toUTC().toSQL()!)
          .where('created_at', '<=', day.endOf('day').toUTC().toSQL()!)
      }
    }

    const paginator = await q.paginate(currentPage, perPage)
    return response.ok({
      data: paginator.all(),
      meta: {
        total: paginator.total,
        perPage: paginator.perPage,
        currentPage: paginator.currentPage,
        lastPage: paginator.lastPage,
      },
    })
  }
}
