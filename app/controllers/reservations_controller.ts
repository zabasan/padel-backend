import type { HttpContext } from '@adonisjs/core/http'
import Reservation from '#models/reservation'
import ReservationHiddenDate from '#models/reservation_hidden_date'
import ReservationAuditLog from '#models/reservation_audit_log'
import ReservationPayment from '#models/reservation_payment'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import CourtPriceHistory from '#models/court_price_history'
import ProfessorPriceHistory from '#models/professor_price_history'
import Setting from '#models/setting'
import User from '#models/user'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const CUSTOM_DURATIONS = [150, 180, 210, 240, 270, 300, 330, 360]

const reservationValidator = vine.compile(
  vine.object({
    courtId: vine.number().positive(),
    startTime: vine.string(),
    duration: vine.number().min(30).max(480),
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
    duration: vine.number().min(30).max(480).optional(),
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

function calculateFootballPrice(priceRanges: CourtPriceRange[], defaultPrice: number, start: DateTime, end: DateTime): number {
  const startART = start.setZone(ART_TZ)
  const endART = end.setZone(ART_TZ)
  const startH = startART.hour + startART.minute / 60
  const endH = (endART.hour === 0 && endART.minute === 0) ? 24 : endART.hour + endART.minute / 60
  const hours = endH - startH

  if (priceRanges.length === 0) return defaultPrice * hours

  let total = 0
  for (const range of priceRanges) {
    const rangeEnd = range.endHour >= 24 ? 24 : range.endHour
    const overlapStart = Math.max(startH, range.startHour)
    const overlapEnd = Math.min(endH, rangeEnd)
    if (overlapEnd > overlapStart) {
      total += (overlapEnd - overlapStart) * Number(range.pricePerHour)
    }
  }
  return Math.round(total * 100) / 100
}

// Calculate price for padel courts: find range matching start time, use duration-specific price
function calculatePadelPrice(priceRanges: CourtPriceRange[], defaultPrice: number, start: DateTime, durationMinutes: number): number {
  if (priceRanges.length === 0) return defaultPrice * (durationMinutes / 60)

  const startART = start.setZone(ART_TZ)
  const startH = startART.hour + startART.minute / 60
  const range = priceRanges.find(r => startH >= r.startHour && startH < r.endHour)
  if (!range) return defaultPrice * (durationMinutes / 60)

  // Use duration-specific price if available
  if (durationMinutes === 60 && range.price60Min != null) return Number(range.price60Min)
  if (durationMinutes === 90 && range.price90Min != null) return Number(range.price90Min)
  if (durationMinutes === 120 && range.price120Min != null) return Number(range.price120Min)

  // Fall back to hourly rate for custom durations or missing duration prices
  return Math.round(Number(range.pricePerHour) * (durationMinutes / 60) * 100) / 100
}

function calculatePrice(court: Court, priceRanges: CourtPriceRange[], start: DateTime, end: DateTime): number {
  const durationMinutes = Math.round(end.diff(start, 'minutes').minutes)
  if (court.type === 'padel') {
    return calculatePadelPrice(priceRanges, court.pricePerHour, start, durationMinutes)
  }
  return calculateFootballPrice(priceRanges, court.pricePerHour, start, end)
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
  const batch = rows.filter(r => r.effectiveFrom.toSQL() === latestTs)

  // Cast to CourtPriceRange shape (same columns) so existing calc functions work
  return batch as unknown as CourtPriceRange[]
}

// Returns professor prices effective at a given date, from history.
async function getHistoricalProfessorPrices(date: DateTime): Promise<{ individual: number; group: number; individualWeekend: number }> {
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
    individualWeekend: map['professorPriceIndividualWeekend'] ? Number(map['professorPriceIndividualWeekend']) : 15000,
  }
}

// Calculate the price for a recurring reservation at a specific occurrence date.
// Returns null if the reservation uses customPrice (caller should use stored value).
async function calcRecurringOccurrencePrice(reservation: Reservation, occurrenceDate: DateTime): Promise<number | null> {
  if (reservation.customPrice != null) return null

  const court = await Court.query().where('id', reservation.courtId).firstOrFail()
  const durationMinutes = Math.round(reservation.endTime.diff(reservation.startTime, 'minutes').minutes)

  // Rebuild start DateTime for this specific occurrence (same time, different date)
  const resStartART = reservation.startTime.setZone(ART_TZ)
  const occurrenceStart = occurrenceDate.setZone(ART_TZ).set({
    hour: resStartART.hour,
    minute: resStartART.minute,
    second: 0,
    millisecond: 0,
  })
  const occurrenceEnd = occurrenceStart.plus({ minutes: durationMinutes })

  const targetUser = await User.find(reservation.userId)
  const isProfessor = targetUser?.role === 'professor'

  let price: number

  if (isProfessor) {
    const profPrices = await getHistoricalProfessorPrices(occurrenceStart)
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
    const historicalRanges = await getHistoricalRanges(reservation.courtId, occurrenceStart)
    price = calculatePrice(court, historicalRanges, occurrenceStart, occurrenceEnd)
  }

  return applyDiscount(price, reservation.discountPercentage ?? 0)
}

// Returns the next occurrence date (ART) for a recurring reservation on or after `from`.
function nextOccurrenceDate(reservation: Reservation, from: DateTime): DateTime {
  const resStartART = reservation.startTime.setZone(ART_TZ)
  const weekday = resStartART.weekday
  let candidate = from.setZone(ART_TZ).startOf('day')
  while (candidate.weekday !== weekday) candidate = candidate.plus({ days: 1 })
  return candidate
}

function timeInMinutes(dt: DateTime): number {
  const art = dt.setZone(ART_TZ)
  return art.hour * 60 + art.minute
}

// Returns the effective consecutive games streak, accounting for hidden dates that have
// already passed since the last increment. A past hidden occurrence breaks the streak.
function effectiveConsecutiveGames(
  r: Reservation,
  hiddenDateStrs: string[]
): number {
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

function toDateStr(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val.slice(0, 10)
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  if (val && typeof (val as any).toISODate === 'function') return (val as any).toISODate()
  return null
}

function hasRecurringConflict(reservations: Reservation[], startTime: DateTime, endTime: DateTime): boolean {
  const startART = startTime.setZone(ART_TZ)
  const endART = endTime.setZone(ART_TZ)
  const startWeekday = startART.weekday
  const startMin = timeInMinutes(startTime)
  const endMin = (endART.hour === 0 && endART.minute === 0) ? 24 * 60 : timeInMinutes(endTime)
  const startDateISO = startART.toISODate()!

  for (const r of reservations) {
    const rStartART = r.startTime.setZone(ART_TZ)
    const rEndART = r.endTime.setZone(ART_TZ)
    if (rStartART.weekday !== startWeekday) continue
    const rStartDateISO = rStartART.toISODate()!
    if (startDateISO < rStartDateISO) continue
    const rStartMin = timeInMinutes(r.startTime)
    const rEndMin = (rEndART.hour === 0 && rEndART.minute === 0) ? 24 * 60 : timeInMinutes(r.endTime)
    if (startMin >= rEndMin || endMin <= rStartMin) continue
    const hiddenDates = (r.hiddenDates ?? []).map(hd => toDateStr(hd.hiddenDate))
    if (hiddenDates.includes(startDateISO)) continue
    return true
  }
  return false
}

async function getRecurringPromoSettings(): Promise<{ enabled: boolean; games: number; freeGames: number }> {
  const rows = await Setting.all()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value ?? ''
  return {
    enabled: map['recurringPromoEnabled'] === 'true',
    games: Number(map['recurringPromoGames'] ?? 0),
    freeGames: Number(map['recurringPromoFreeGames'] ?? 0),
  }
}

async function logReservationChange(performedBy: number, reservationId: number, field: string, oldValue: string | null, newValue: string | null) {
  await ReservationAuditLog.create({ performedBy, reservationId, field, oldValue, newValue })
}

// Serializes a reservation for the listing, attaching per-occurrence payment state, promo
// info and the current occurrence price for recurring rows. Shared by the paginated and
// legacy (array) branches of `index`.
async function serializeReservationRow(
  r: Reservation,
  promo: { enabled: boolean; games: number; freeGames: number },
  nowART: DateTime
): Promise<Record<string, any>> {
  const obj = r.toJSON()
  // Serialize hidden dates as a flat array of date strings
  obj.hiddenDates = (r.hiddenDates ?? []).map(hd => toDateStr(hd.hiddenDate)).filter(Boolean)

  // Per-occurrence TOTAL payment state for recurring reservations. The series-level
  // `totalPaid` boolean is unreliable across occurrences, so derive each occurrence's
  // paid state from ReservationPayment rows keyed by occurrence_date. The deposit is
  // intentionally NOT per-occurrence — for a fija it's a one-time hold for the series.
  if (r.isRecurring) {
    const totalDates: string[] = []
    for (const p of r.payments ?? []) {
      if (p.occurrenceDate && p.type === 'total') totalDates.push(p.occurrenceDate)
    }
    obj.paidOccurrences = totalDates
    const nextDateStr = nextOccurrenceDate(r, nowART).toISODate()
    obj.totalPaid = nextDateStr != null && totalDates.includes(nextDateStr)
  }

  if (r.isRecurring && promo.enabled && promo.games > 0) {
    const cycle = promo.games + promo.freeGames
    const effectiveGames = effectiveConsecutiveGames(r, obj.hiddenDates)
    const posInCycle = effectiveGames % cycle
    obj.isFreeGame = posInCycle >= promo.games
    obj.consecutiveGamesDisplay = effectiveGames
    obj.freeGamePosition = promo.games
    obj.promoCycle = cycle
  } else {
    obj.isFreeGame = false
  }

  // For recurring reservations, compute the price at the next upcoming occurrence
  // so the UI shows the current price rather than the stale stored one.
  if (r.isRecurring && r.customPrice == null) {
    try {
      const nextOccurrence = nextOccurrenceDate(r, nowART)
      const occurrencePrice = await calcRecurringOccurrencePrice(r, nextOccurrence)
      if (occurrencePrice !== null) {
        obj.occurrencePrice = occurrencePrice
      }
    } catch {
      // If price calc fails, fall back to stored totalPrice — never crash the listing
    }
  }

  return obj
}

export default class ReservationsController {
  async index({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const from = request.input('from')
    const to = request.input('to')

    if (request.input('summary') === 'true') {
      // start_time + is_recurring are needed to weekday-filter recurring rows; stripped before responding.
      let summaryQuery = Reservation.query().select('id', 'status', 'start_time', 'is_recurring')
      if (user.role === 'customer' || user.role === 'professor') {
        summaryQuery = summaryQuery.where('user_id', user.id)
      }
      // Mirror the main listing: recurring series are date-independent (the `to` bound still applies).
      if (from) {
        const fromSQL = DateTime.fromISO(from).toUTC().toSQL()!
        summaryQuery = summaryQuery.where(q => q.where('start_time', '>=', fromSQL).orWhere('is_recurring', true))
      }
      if (to) summaryQuery = summaryQuery.where('start_time', '<=', DateTime.fromISO(to).toUTC().toSQL()!)
      const rows = filterRecurringByRange(await summaryQuery, from, to)
      return response.ok(rows.map(r => ({ id: r.id, status: r.status })))
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
        .preload('court').preload('user').preload('customer').preload('hiddenDates').preload('payments')

      if (user.role === 'customer' || user.role === 'professor') {
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
        pq = pq.where(sub => {
          sub.whereHas('user', u => {
            u.where('full_name', 'like', like).orWhere('phone', 'like', like)
          }).orWhere('contact_phone', 'like', like)
        })
      }

      // Match the previous client-side ordering: pending → confirmed → cancelled, then newest first.
      pq = pq
        .orderByRaw("CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 1 END")
        .orderBy('start_time', 'desc')

      const paginator = await pq.paginate(currentPage, perPage)

      const promo = await getRecurringPromoSettings()
      const nowART = DateTime.now().setZone(ART_TZ)
      const data = await Promise.all(paginator.all().map(r => serializeReservationRow(r, promo, nowART)))

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

    let query = Reservation.query().preload('court').preload('user').preload('customer').preload('hiddenDates').preload('payments')

    if (user.role === 'customer' || user.role === 'professor') {
      query = query.where('user_id', user.id)
    }

    if (from) {
      const fromSQL = DateTime.fromISO(from).toUTC().toSQL()!
      query = query.where(q => q.where('start_time', '>=', fromSQL).orWhere('is_recurring', true))
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
    const result = await Promise.all(rows.map(r => serializeReservationRow(r, promo, nowART)))

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
      .firstOrFail()

    if ((user.role === 'customer' || user.role === 'professor') && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    const obj = reservation.toJSON()

    // For a recurring reservation, the price effective on each occurrence may differ
    // (e.g. court prices changed over time). When the caller asks about a specific
    // occurrence date, compute the price that was effective on that date rather than
    // the stored/next-occurrence value.
    const dateParam = request.input('date')
    if (dateParam && reservation.isRecurring && reservation.customPrice == null) {
      const occurrenceDate = DateTime.fromISO(dateParam, { zone: ART_TZ })
      if (occurrenceDate.isValid) {
        try {
          const occurrencePrice = await calcRecurringOccurrencePrice(reservation, occurrenceDate)
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

    const endTimeART = endTime.setZone(ART_TZ)
    const endSQL = (endTimeART.hour === 0 && endTimeART.minute === 0)
      ? endTime.toUTC().endOf('day').toSQL()!
      : endTime.toUTC().toSQL()!
    const startSQL = startTime.toUTC().toSQL()!

    // Validate custom duration for padel (professors only) and football (admin/worker only)
    const isPadelCourt = court.type === 'padel'
    const isFootballCourt = court.type === 'football'
    const isAdminOrWorker = user.role === 'admin' || user.role === 'worker'
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

    // Professor restrictions: padel only, within configured hours
    if (isProfessor || targetIsProfessor) {
      if (!isPadelCourt) {
        return response.badRequest({ message: 'Los profesores solo pueden reservar canchas de pádel' })
      }
      const rows = await Setting.all()
      const cfg: Record<string, string | null> = {}
      for (const r of rows) cfg[r.key] = r.value
      const profStartHour = cfg['professorStartHour'] != null ? Number(cfg['professorStartHour']) : 8
      const profEndHour = cfg['professorEndHour'] != null ? Number(cfg['professorEndHour']) : 18
      const startART = startTime.setZone(ART_TZ)
      const endART = endTime.setZone(ART_TZ)
      const startHour = startART.hour + startART.minute / 60
      const endHour = endART.hour + endART.minute / 60
      if (startHour < profStartHour) {
        return response.badRequest({ message: `Las reservas de profesores deben comenzar desde las ${String(profStartHour).padStart(2,'0')}:00` })
      }
      if (endHour > profEndHour) {
        return response.badRequest({ message: `Las reservas de profesores deben terminar a las ${String(profEndHour).padStart(2,'0')}:00 o antes` })
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

    if (directConflict) return response.conflict({ message: 'La cancha ya está reservada en ese horario' })

    const recurringOnCourt = await Reservation.query()
      .where('court_id', data.courtId)
      .where('is_recurring', true)
      .whereNot('status', 'cancelled')
      .preload('hiddenDates')

    if (hasRecurringConflict(recurringOnCourt, startTime, endTime)) {
      return response.conflict({ message: 'La cancha ya está reservada en ese horario (reserva recurrente)' })
    }

    // Siblings can be reserved independently — only check parent (if booking a child)
    // or all children (if booking a parent).
    const relatedCourtIds: number[] = []
    if (court.parentCourtId) {
      relatedCourtIds.push(court.parentCourtId)
    }
    if (court.subCourts.length > 0) {
      for (const sc of court.subCourts) relatedCourtIds.push(sc.id)
    }

    if (relatedCourtIds.length > 0) {
      const relatedDirectConflict = await Reservation.query()
        .whereIn('court_id', relatedCourtIds)
        .where('is_recurring', false)
        .whereNot('status', 'cancelled')
        .where('start_time', '<', endSQL)
        .where('end_time', '>', startSQL)
        .first()

      if (relatedDirectConflict) {
        const isParentConflict = relatedDirectConflict.courtId === court.parentCourtId
        return response.conflict({ message: isParentConflict
          ? 'No se puede reservar: la cancha completa ya está reservada en ese horario'
          : 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas'
        })
      }

      const relatedRecurring = await Reservation.query()
        .whereIn('court_id', relatedCourtIds)
        .where('is_recurring', true)
        .whereNot('status', 'cancelled')
        .preload('hiddenDates')

      if (relatedRecurring.length > 0) {
        const parentRecurring = relatedRecurring.filter(r => r.courtId === court.parentCourtId)
        const subRecurring = relatedRecurring.filter(r => r.courtId !== court.parentCourtId)
        if (parentRecurring.length > 0 && hasRecurringConflict(parentRecurring, startTime, endTime)) {
          return response.conflict({ message: 'No se puede reservar: la cancha completa ya está reservada en ese horario' })
        }
        if (subRecurring.length > 0 && hasRecurringConflict(subRecurring, startTime, endTime)) {
          return response.conflict({ message: 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas' })
        }
      }
    }

    // Price calculation
    let totalPrice: number
    if (data.customPrice != null && (isProfessor || targetIsProfessor || isAdminOrWorker)) {
      totalPrice = data.customPrice
    } else if (targetIsProfessor || isProfessor) {
      const rows2 = await Setting.all()
      const cfg2: Record<string, string | null> = {}
      for (const r of rows2) cfg2[r.key] = r.value
      const isWeekend = startTime.setZone(ART_TZ).weekday >= 6
      const classType = data.classType ?? 'individual'
      let professorPrice: number
      if (classType === 'grupal') {
        professorPrice = cfg2['professorPriceGroup'] != null ? Number(cfg2['professorPriceGroup']) : 15000
      } else if (isWeekend) {
        professorPrice = cfg2['professorPriceIndividualWeekend'] != null ? Number(cfg2['professorPriceIndividualWeekend'])
          : (cfg2['professorPriceIndividual'] != null ? Number(cfg2['professorPriceIndividual']) : 12000)
      } else {
        professorPrice = cfg2['professorPriceIndividual'] != null ? Number(cfg2['professorPriceIndividual']) : 12000
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
      customPrice: data.customPrice ?? null,
      classType: data.classType ?? null,
    })

    await reservation.load('court')
    await reservation.load('user')

    if (isAdminOrWorker) {
      await logReservationChange(user.id, reservation.id, 'created', null, 'pending')
    }

    return response.created(reservation)
  }

  async update({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.findOrFail(params.id)

    if (user.role === 'customer') {
      return response.forbidden({ message: 'Sin permisos para modificar reservas' })
    }
    if (user.role === 'professor' && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    const isAdminOrWorker = user.role === 'admin' || user.role === 'worker'

    // Status-only update (confirm/cancel)
    const status = request.input('status')
    if (status && ['pending', 'confirmed', 'cancelled'].includes(status) && isAdminOrWorker) {
      // Past reservations can only be cancelled by an admin (workers are limited to upcoming ones)
      const isPast = !reservation.isRecurring && reservation.endTime < DateTime.now()
      if (status === 'cancelled' && isPast && user.role === 'worker') {
        return response.forbidden({ message: 'Solo un administrador puede cancelar una reserva pasada' })
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
    const court = await Court.query().where('id', courtId).preload('priceRanges').preload('subCourts').firstOrFail()

    const startTime = data.startTime ? DateTime.fromISO(data.startTime) : reservation.startTime
    const currentDurationMin = Math.round(reservation.endTime.diff(reservation.startTime, 'minutes').minutes)
    const duration = data.duration ?? currentDurationMin
    const endTime = startTime.plus({ minutes: duration })

    // Conflict checks (skip for recurring reservations being edited)
    if (!reservation.isRecurring) {
      const endTimeCART = endTime.setZone(ART_TZ)
      const endSQLc = (endTimeCART.hour === 0 && endTimeCART.minute === 0)
        ? endTime.toUTC().endOf('day').toSQL()!
        : endTime.toUTC().toSQL()!
      const startSQLc = startTime.toUTC().toSQL()!

      const directConflict = await Reservation.query()
        .where('court_id', courtId)
        .whereNot('id', reservation.id)
        .where('is_recurring', false)
        .whereNot('status', 'cancelled')
        .where('start_time', '<', endSQLc)
        .where('end_time', '>', startSQLc)
        .first()

      if (directConflict) return response.conflict({ message: 'La cancha ya está reservada en ese horario' })

      const recurringOnCourt = await Reservation.query()
        .where('court_id', courtId)
        .whereNot('id', reservation.id)
        .where('is_recurring', true)
        .whereNot('status', 'cancelled')
        .preload('hiddenDates')

      if (hasRecurringConflict(recurringOnCourt, startTime, endTime)) {
        return response.conflict({ message: 'La cancha ya está reservada en ese horario (reserva recurrente)' })
      }

      const relatedCourtIds: number[] = []
      if (court.parentCourtId) {
        relatedCourtIds.push(court.parentCourtId)
      }
      if (court.subCourts.length > 0) {
        for (const sc of court.subCourts) relatedCourtIds.push(sc.id)
      }

      if (relatedCourtIds.length > 0) {
        const relatedDirectConflict = await Reservation.query()
          .whereIn('court_id', relatedCourtIds)
          .where('is_recurring', false)
          .whereNot('status', 'cancelled')
          .where('start_time', '<', endSQLc)
          .where('end_time', '>', startSQLc)
          .first()

        if (relatedDirectConflict) {
          const isParentConflict = relatedDirectConflict.courtId === court.parentCourtId
          return response.conflict({ message: isParentConflict
            ? 'No se puede reservar: la cancha completa ya está reservada en ese horario'
            : 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas'
          })
        }

        const relatedRecurring = await Reservation.query()
          .whereIn('court_id', relatedCourtIds)
          .where('is_recurring', true)
          .whereNot('status', 'cancelled')
          .preload('hiddenDates')

        if (relatedRecurring.length > 0) {
          const parentRecurring = relatedRecurring.filter(r => r.courtId === court.parentCourtId)
          const subRecurring = relatedRecurring.filter(r => r.courtId !== court.parentCourtId)
          if (parentRecurring.length > 0 && hasRecurringConflict(parentRecurring, startTime, endTime)) {
            return response.conflict({ message: 'No se puede reservar: la cancha completa ya está reservada en ese horario' })
          }
          if (subRecurring.length > 0 && hasRecurringConflict(subRecurring, startTime, endTime)) {
            return response.conflict({ message: 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas' })
          }
        }
      }
    }

    // Determine target user role for price calculation
    const targetUser = await User.find(reservation.userId)
    const targetIsProfessor = targetUser?.role === 'professor'

    // Price recalc
    let totalPrice: number
    if (data.customPrice != null && (isAdminOrWorker || targetIsProfessor)) {
      totalPrice = data.customPrice
    } else if (targetIsProfessor) {
      const rows2 = await Setting.all()
      const cfg2: Record<string, string | null> = {}
      for (const r of rows2) cfg2[r.key] = r.value
      const isWeekend = startTime.setZone(ART_TZ).weekday >= 6
      const classType = data.classType ?? reservation.classType ?? 'individual'
      let professorPrice: number
      if (classType === 'grupal') {
        professorPrice = cfg2['professorPriceGroup'] != null ? Number(cfg2['professorPriceGroup']) : 15000
      } else if (isWeekend) {
        professorPrice = cfg2['professorPriceIndividualWeekend'] != null ? Number(cfg2['professorPriceIndividualWeekend'])
          : (cfg2['professorPriceIndividual'] != null ? Number(cfg2['professorPriceIndividual']) : 12000)
      } else {
        professorPrice = cfg2['professorPriceIndividual'] != null ? Number(cfg2['professorPriceIndividual']) : 12000
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
      auditFields['startTime'] = { old: reservation.startTime.toUTC().toISO(), new: startTime.toUTC().toISO() }
    }
    if (data.duration !== undefined && duration !== currentDurationMin) {
      auditFields['duration'] = { old: String(currentDurationMin), new: String(duration) }
    }
    if (data.courtId !== undefined && data.courtId !== reservation.courtId) {
      auditFields['courtId'] = { old: String(reservation.courtId), new: String(data.courtId) }
    }
    if (data.customPrice !== undefined && data.customPrice !== reservation.customPrice) {
      auditFields['customPrice'] = { old: String(reservation.customPrice ?? ''), new: String(data.customPrice ?? '') }
    }
    if (data.discountPercentage !== undefined && Number(data.discountPercentage) !== Number(reservation.discountPercentage ?? 0)) {
      auditFields['discountPercentage'] = { old: String(reservation.discountPercentage ?? 0), new: String(data.discountPercentage) }
    }
    if (data.notes !== undefined && data.notes !== reservation.notes) {
      auditFields['notes'] = { old: reservation.notes, new: data.notes }
    }
    if (data.contactPhone !== undefined && data.contactPhone !== reservation.contactPhone) {
      auditFields['contactPhone'] = { old: reservation.contactPhone, new: data.contactPhone }
    }
    if (data.isRecurring !== undefined && data.isRecurring !== reservation.isRecurring) {
      auditFields['isRecurring'] = { old: String(reservation.isRecurring), new: String(data.isRecurring) }
    }
    if (data.depositPercentage !== undefined && Number(data.depositPercentage) !== Number(reservation.depositPercentage ?? 0)) {
      auditFields['depositPercentage'] = { old: String(reservation.depositPercentage ?? ''), new: String(data.depositPercentage) }
    }
    if (data.depositFixedAmount !== undefined && Number(data.depositFixedAmount ?? 0) !== Number(reservation.depositFixedAmount ?? 0)) {
      auditFields['depositFixedAmount'] = { old: String(reservation.depositFixedAmount ?? ''), new: String(data.depositFixedAmount ?? '') }
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
      customPrice: data.customPrice !== undefined ? data.customPrice : reservation.customPrice,
      classType: data.classType !== undefined ? data.classType : reservation.classType,
      contactPhone: data.contactPhone !== undefined ? data.contactPhone : reservation.contactPhone,
      notes: data.notes !== undefined ? data.notes : reservation.notes,
      isRecurring: data.isRecurring !== undefined ? data.isRecurring : reservation.isRecurring,
      depositPercentage: data.depositPercentage !== undefined ? data.depositPercentage : reservation.depositPercentage,
      depositFixedAmount: data.depositFixedAmount !== undefined ? data.depositFixedAmount : reservation.depositFixedAmount,
    })

    if (data.customerId !== undefined) {
      reservation.userId = data.customerId ?? reservation.userId
    }

    await reservation.save()

    for (const [field, vals] of Object.entries(auditFields)) {
      await logReservationChange(user.id, reservation.id, field, vals.old, vals.new)
    }

    return response.ok(reservation)
  }

  async destroy({ params, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.findOrFail(params.id)

    if (user.role === 'customer' && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    if (reservation.status === 'confirmed') {
      if (user.role === 'customer') {
        return response.forbidden({ message: 'Las reservas confirmadas solo pueden cancelarlas admin o empleados' })
      }
      // Admin/worker can cancel any confirmed reservation regardless of time
    }

    // Past reservations can only be cancelled by an admin (workers are limited to upcoming ones)
    const isPast = !reservation.isRecurring && reservation.endTime < DateTime.now()
    if (isPast && user.role === 'worker') {
      return response.forbidden({ message: 'Solo un administrador puede cancelar una reserva pasada' })
    }

    const oldStatus = reservation.status
    reservation.status = 'cancelled'
    if (!reservation.cancelledAt) {
      reservation.cancelledAt = DateTime.now()
      reservation.cancelledBy = user.id
    }
    await reservation.save()
    await logReservationChange(user.id, reservation.id, 'status', oldStatus, 'cancelled')
    return response.ok({ message: 'Reserva cancelada correctamente' })
  }

  async hideNext({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

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

    // Insert into pivot table (ignore duplicate)
    await ReservationHiddenDate.updateOrCreate(
      { reservationId: reservation.id, hiddenDate: targetDateStr },
      { reservationId: reservation.id, hiddenDate: targetDateStr }
    )

    // If this hidden date corresponds to the occurrence that was already incremented,
    // roll back the consecutive games counter so the promo cycle stays correct.
    if (reservation.lastIncrementedAt) {
      const resStartART = reservation.startTime.setZone(ART_TZ)
      const hiddenDt = DateTime.fromISO(targetDateStr, { zone: ART_TZ }).set({
        hour: resStartART.hour,
        minute: resStartART.minute,
        second: 0,
        millisecond: 0,
      })
      const incrementedDt = reservation.lastIncrementedAt.setZone(ART_TZ)
      // Same occurrence if lastIncrementedAt falls within the same day as the hidden date
      if (incrementedDt >= hiddenDt && incrementedDt < hiddenDt.plus({ days: 1 })) {
        if (reservation.consecutiveGames > 0) {
          reservation.consecutiveGames -= 1
        }
        reservation.lastIncrementedAt = null
        await reservation.save()
      }
    }

    await logReservationChange(user.id, reservation.id, 'hiddenDate', null, targetDateStr)

    await reservation.load('hiddenDates')
    const obj = reservation.toJSON()
    obj.hiddenDates = (reservation.hiddenDates ?? []).map(hd => toDateStr(hd.hiddenDate)).filter(Boolean)
    return response.ok(obj)
  }

  async incrementGames({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

    // Idempotency: find this week's occurrence datetime and skip if already incremented
    const now = DateTime.now().setZone(ART_TZ)
    const resStartART = reservation.startTime.setZone(ART_TZ)
    const weekday = resStartART.weekday // 1=Mon ... 7=Sun
    // Find the most recent past occurrence (same weekday + time)
    let occurrence = now.set({
      hour: resStartART.hour,
      minute: resStartART.minute,
      second: 0,
      millisecond: 0,
    })
    const daysBack = ((now.weekday - weekday + 7) % 7)
    occurrence = occurrence.minus({ days: daysBack })
    // If occurrence is in the future (same weekday but later today), go back one week
    if (occurrence > now) occurrence = occurrence.minus({ weeks: 1 })

    if (reservation.lastIncrementedAt && reservation.lastIncrementedAt >= occurrence) {
      // Already incremented for this occurrence — no-op
      return response.ok(reservation)
    }

    const promo = await getRecurringPromoSettings()

    // Check if a hidden occurrence fell between lastIncrementedAt and now — streak broken
    await reservation.load('hiddenDates')
    const lastIncremented = reservation.lastIncrementedAt
    const streakBroken = (reservation.hiddenDates ?? []).some((hd) => {
      const hdDt = DateTime.fromISO(
        typeof hd.hiddenDate === 'string' ? hd.hiddenDate : hd.hiddenDate,
        { zone: ART_TZ }
      ).set({ hour: resStartART.hour, minute: resStartART.minute, second: 0, millisecond: 0 })
      const afterLast = lastIncremented ? hdDt > lastIncremented : hdDt >= resStartART.startOf('day')
      return afterLast && hdDt < occurrence
    })

    if (streakBroken) {
      reservation.consecutiveGames = 0
    }

    reservation.consecutiveGames += 1
    reservation.lastIncrementedAt = now
    // Reset totalPaid so the payment button reappears for the next occurrence
    reservation.totalPaid = false

    // Auto-reset after completing free games
    if (promo.enabled && promo.games > 0 && promo.freeGames > 0) {
      const cycle = promo.games + promo.freeGames
      if (reservation.consecutiveGames >= cycle) {
        reservation.consecutiveGames = 0
      }
    }

    await reservation.save()
    return response.ok(reservation)
  }

  async payDeposit({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    // The deposit is a one-time hold per series (also for fijas), so the guard stays series-level.
    if (reservation.depositPaid) return response.badRequest({ message: 'La seña ya fue registrada' })

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
    await logReservationChange(user.id, reservation.id, 'depositPayment', null, `${depositWord}: ${auditNote}`)

    if (oldStatus !== 'confirmed') {
      await logReservationChange(user.id, reservation.id, 'status', oldStatus, 'confirmed')
    }
    return response.ok(reservation)
  }

  async payTotal({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)

    // For recurring reservations, payment is tracked per occurrence date.
    let occurrenceDate: string | null = null
    if (reservation.isRecurring) {
      const nowART = DateTime.now().setZone(ART_TZ)
      occurrenceDate = nextOccurrenceDate(reservation, nowART).toISODate()
    }

    // For reservations with a deposit requirement, the (one-time, series-level) deposit must be
    // paid first. For recurring reservations without a deposit set, allow direct payment.
    const hasDepositRequirement = reservation.depositPercentage != null || reservation.depositFixedAmount != null
    if (hasDepositRequirement && !reservation.depositPaid) {
      return response.badRequest({ message: reservation.isRecurring ? 'Primero debe registrarse el depósito' : 'Primero debe registrarse el pago de la seña' })
    }

    // Already-paid guard: per occurrence for recurring, per series otherwise.
    if (reservation.isRecurring) {
      const existing = await ReservationPayment.query()
        .where('reservation_id', reservation.id)
        .where('type', 'total')
        .where('occurrence_date', occurrenceDate!)
        .first()
      if (existing) return response.badRequest({ message: 'El pago de este turno ya fue registrado' })
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
    await reservation.save()

    // Record payment breakdown
    await ReservationPayment.create({
      reservationId: reservation.id,
      type: 'total',
      efectivo,
      transferencia,
      postnet,
      total: payTotal,
      paidBy: user.id,
      receipt: receipt || null,
      occurrenceDate,
    })

    const auditNote = occurrenceDate ? `$${payTotal} (${occurrenceDate})` : `$${payTotal}`
    await logReservationChange(user.id, reservation.id, 'totalPayment', null, `Pago: ${auditNote}`)

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

    const directReservations = await Reservation.query()
      .where('court_id', courtId)
      .whereNot('status', 'cancelled')
      .where('is_recurring', false)
      .where('start_time', '>=', start.toUTC().toSQL()!)
      .where('start_time', '<=', end.toUTC().toSQL()!)
      .orderBy('start_time', 'asc')

    const allRecurring = await Reservation.query()
      .where('court_id', courtId)
      .whereNot('status', 'cancelled')
      .where('is_recurring', true)
      .where('start_time', '<=', end.toUTC().toSQL()!)
      .preload('hiddenDates')

    const activeRecurring = allRecurring.filter(r => {
      if (r.startTime.setZone(ART_TZ).weekday !== queryWeekday) return false
      const hiddenDates = (r.hiddenDates ?? []).map(hd => toDateStr(hd.hiddenDate))
      if (hiddenDates.includes(queryDateStr)) return false
      return true
    })

    return response.ok([...directReservations, ...activeRecurring])
  }

  async showNext({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

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
    obj.hiddenDates = (reservation.hiddenDates ?? []).map(hd => toDateStr(hd.hiddenDate)).filter(Boolean)
    return response.ok(obj)
  }

  async auditLogs({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role !== 'admin' && user.role !== 'worker') return response.forbidden({ message: 'Sin permisos' })

    const logs = await ReservationAuditLog.query()
      .where('reservation_id', params.id)
      .preload('performer', q => q.select('id', 'full_name', 'email'))
      .orderBy('created_at', 'desc')

    return response.ok(logs)
  }

  async revert({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role !== 'admin') return response.forbidden({ message: 'Solo administradores pueden revertir reservas' })

    const reservation = await Reservation.findOrFail(params.id)
    if (reservation.status !== 'cancelled') return response.badRequest({ message: 'Solo se pueden revertir reservas canceladas' })

    reservation.status = 'pending'
    reservation.cancelledAt = null
    reservation.cancelledBy = null
    await reservation.save()
    await logReservationChange(user.id, reservation.id, 'status', 'cancelled', 'pending')

    return response.ok(reservation)
  }

  async revertPayment({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role !== 'admin') return response.forbidden({ message: 'Solo administradores pueden revertir pagos' })

    const reservation = await Reservation.findOrFail(params.id)
    const payment = await ReservationPayment.findOrFail(params.paymentId)

    if (payment.reservationId !== reservation.id) {
      return response.badRequest({ message: 'El pago no pertenece a esta reserva' })
    }

    const auditOld = JSON.stringify({
      type: payment.type,
      total: payment.total,
      efectivo: payment.efectivo,
      transferencia: payment.transferencia,
      postnet: payment.postnet,
      occurrenceDate: payment.occurrenceDate ?? undefined,
    })

    await payment.delete()

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

    await reservation.load('payments')
    return response.ok(reservation)
  }

  async revertAllPayments({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role !== 'admin') return response.forbidden({ message: 'Solo administradores pueden revertir pagos' })

    const reservation = await Reservation.findOrFail(params.id)
    const payments = await ReservationPayment.query().where('reservation_id', reservation.id)

    if (payments.length === 0) return response.badRequest({ message: 'No hay pagos registrados para esta reserva' })

    const auditSummary = JSON.stringify(
      payments.map(p => ({
        type: p.type,
        total: p.total,
        efectivo: p.efectivo,
        transferencia: p.transferencia,
        postnet: p.postnet,
        occurrenceDate: p.occurrenceDate ?? undefined,
      }))
    )

    await ReservationPayment.query().where('reservation_id', reservation.id).delete()

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

    await reservation.load('payments')
    return response.ok(reservation)
  }

  async auditLogsAll({ auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role !== 'admin') return response.forbidden({ message: 'Sin permisos' })

    const logs = await ReservationAuditLog.query()
      .preload('performer', q => q.select('id', 'full_name', 'email', 'role'))
      .preload('reservation', q => q.preload('court', c => c.select('id', 'name')))
      .orderBy('created_at', 'desc')
      .limit(500)

    return response.ok(logs)
  }
}
