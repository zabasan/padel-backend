import type { HttpContext } from '@adonisjs/core/http'
import Reservation from '#models/reservation'
import ReservationAuditLog from '#models/reservation_audit_log'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
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
  })
)

// Calculate price for football courts: hours × pricePerHour
function calculateFootballPrice(priceRanges: CourtPriceRange[], defaultPrice: number, start: DateTime, end: DateTime): number {
  const startH = start.hour + start.minute / 60
  const endH = (end.hour === 0 && end.minute === 0) ? 24 : end.hour + end.minute / 60
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

  const startH = start.hour + start.minute / 60
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

function timeInMinutes(dt: DateTime): number {
  return dt.hour * 60 + dt.minute
}

function toDateStr(val: unknown): string | null {
  if (!val) return null
  if (typeof val === 'string') return val.slice(0, 10)
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  if (val && typeof (val as any).toISODate === 'function') return (val as any).toISODate()
  return null
}

function hasRecurringConflict(reservations: Reservation[], startTime: DateTime, endTime: DateTime): boolean {
  const startWeekday = startTime.weekday
  const startMin = timeInMinutes(startTime)
  const endMin = (endTime.hour === 0 && endTime.minute === 0) ? 24 * 60 : timeInMinutes(endTime)
  const startDateISO = startTime.toISODate()!

  for (const r of reservations) {
    if (r.startTime.weekday !== startWeekday) continue
    const rStartMin = timeInMinutes(r.startTime)
    const rEndMin = (r.endTime.hour === 0 && r.endTime.minute === 0) ? 24 * 60 : timeInMinutes(r.endTime)
    if (startMin >= rEndMin || endMin <= rStartMin) continue
    const hiddenUntilStr = toDateStr(r.hiddenUntil)
    if (hiddenUntilStr && startDateISO < hiddenUntilStr) continue
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

export default class ReservationsController {
  async index({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const from = request.input('from')
    const to = request.input('to')

    if (request.input('summary') === 'true') {
      let summaryQuery = Reservation.query().select('id', 'status')
      if (user.role === 'customer' || user.role === 'professor') {
        summaryQuery = summaryQuery.where('user_id', user.id)
      }
      if (from) summaryQuery = summaryQuery.where('start_time', '>=', DateTime.fromISO(from).startOf('day').toSQL()!)
      if (to) summaryQuery = summaryQuery.where('start_time', '<=', DateTime.fromISO(to).endOf('day').toSQL()!)
      const reservations = await summaryQuery
      return response.ok(reservations)
    }

    let query = Reservation.query().preload('court').preload('user').preload('customer')

    if (user.role === 'customer' || user.role === 'professor') {
      query = query.where('user_id', user.id)
    }

    if (from) {
      const fromSQL = DateTime.fromISO(from).startOf('day').toSQL()!
      query = query.where(q => q.where('start_time', '>=', fromSQL).orWhere('is_recurring', true))
    }
    if (to) query = query.where('start_time', '<=', DateTime.fromISO(to).endOf('day').toSQL()!)

    const reservations = await query.orderBy('start_time', 'asc')

    // Attach promo info for recurring reservations
    const promo = await getRecurringPromoSettings()
    const result = reservations.map(r => {
      const obj = r.toJSON()
      if (r.isRecurring && promo.enabled && promo.games > 0) {
        const cycle = promo.games + promo.freeGames
        const posInCycle = r.consecutiveGames % cycle
        obj.isFreeGame = posInCycle >= promo.games
        obj.consecutiveGamesDisplay = r.consecutiveGames
        obj.freeGamePosition = promo.games
        obj.promoCycle = cycle
      } else {
        obj.isFreeGame = false
      }
      return obj
    })

    return response.ok(result)
  }

  async show({ params, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.query()
      .where('id', params.id)
      .preload('court')
      .preload('user')
      .preload('customer')
      .firstOrFail()

    if ((user.role === 'customer' || user.role === 'professor') && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }
    return response.ok(reservation)
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

    const endSQL = (endTime.hour === 0 && endTime.minute === 0)
      ? DateTime.fromISO(data.startTime).endOf('day').toSQL()!
      : endTime.toSQL()!
    const startSQL = startTime.toSQL()!

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

    // Validate duration
    if (isPadelCourt && !targetIsProfessor && !isProfessor) {
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
    })

    await reservation.load('court')
    await reservation.load('user')

    return response.created(reservation)
  }

  async update({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.findOrFail(params.id)

    if (user.role === 'customer' && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }
    if (user.role === 'professor' && reservation.userId !== user.id) {
      return response.forbidden({ message: 'Acceso denegado' })
    }

    const isAdminOrWorker = user.role === 'admin' || user.role === 'worker'

    // Status-only update (confirm/cancel)
    const status = request.input('status')
    if (status && ['pending', 'confirmed', 'cancelled'].includes(status) && isAdminOrWorker) {
      if (status === 'cancelled' && reservation.status === 'confirmed') {
        if (reservation.startTime < DateTime.now()) {
          return response.badRequest({ message: 'No se puede cancelar una reserva que ya ocurrió' })
        }
      }
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
      return response.ok(reservation)
    }

    // Full edit — only admin/worker can edit any reservation
    if (!isAdminOrWorker) {
      if (reservation.status !== 'pending') {
        return response.badRequest({ message: 'Solo se pueden modificar reservas pendientes' })
      }
    }

    // Block editing past reservations (non-recurring only)
    if (!reservation.isRecurring && reservation.endTime < DateTime.now()) {
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
      const endSQLc = (endTime.hour === 0 && endTime.minute === 0)
        ? startTime.endOf('day').toSQL()!
        : endTime.toSQL()!
      const startSQLc = startTime.toSQL()!

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
    } else {
      totalPrice = calculatePrice(court, court.priceRanges, startTime, endTime)
    }
    const discountPct = data.discountPercentage ?? reservation.discountPercentage ?? 0
    totalPrice = applyDiscount(totalPrice, discountPct)

    // Build audit log
    const auditFields: Record<string, { old: string | null; new: string | null }> = {}

    if (data.startTime && reservation.startTime.toISO() !== startTime.toISO()) {
      auditFields['startTime'] = { old: reservation.startTime.toISO(), new: startTime.toISO() }
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
    if (data.discountPercentage !== undefined && data.discountPercentage !== reservation.discountPercentage) {
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
    if (data.depositPercentage !== undefined && data.depositPercentage !== reservation.depositPercentage) {
      auditFields['depositPercentage'] = { old: String(reservation.depositPercentage ?? ''), new: String(data.depositPercentage) }
    }
    if (data.depositFixedAmount !== undefined && data.depositFixedAmount !== reservation.depositFixedAmount) {
      auditFields['depositFixedAmount'] = { old: String(reservation.depositFixedAmount ?? ''), new: String(data.depositFixedAmount ?? '') }
    }
    if (data.customerId !== undefined && data.customerId !== reservation.userId) {
      auditFields['userId'] = { old: String(reservation.userId), new: String(data.customerId) }
    }

    // Apply new total price audit if changed
    if (Math.abs(totalPrice - Number(reservation.totalPrice)) > 0.001) {
      auditFields['totalPrice'] = { old: String(reservation.totalPrice), new: String(totalPrice) }
    }

    reservation.merge({
      courtId,
      startTime,
      endTime,
      totalPrice,
      discountPercentage: discountPct,
      customPrice: data.customPrice !== undefined ? data.customPrice : reservation.customPrice,
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

    // Save audit logs
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
      if (reservation.startTime < DateTime.now()) {
        return response.badRequest({ message: 'No se puede cancelar una reserva que ya ocurrió' })
      }
    }

    reservation.status = 'cancelled'
    if (!reservation.cancelledAt) {
      reservation.cancelledAt = DateTime.now()
      reservation.cancelledBy = user.id
    }
    await reservation.save()
    return response.ok({ message: 'Reserva cancelada correctamente' })
  }

  async hideNext({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

    const startWeekday = reservation.startTime.weekday
    let next = DateTime.now().startOf('day').plus({ days: 1 })
    while (next.weekday !== startWeekday) {
      next = next.plus({ days: 1 })
    }

    reservation.consecutiveGamesSnapshot = reservation.consecutiveGames
    reservation.hiddenUntil = next.plus({ days: 1 }).toISODate()!
    reservation.consecutiveGames = 0
    await reservation.save()
    return response.ok(reservation)
  }

  async incrementGames({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

    // Idempotency: find this week's occurrence datetime and skip if already incremented
    const now = DateTime.now()
    const weekday = reservation.startTime.weekday // 1=Mon ... 7=Sun
    // Find the most recent past occurrence (same weekday + time)
    let occurrence = now.set({
      hour: reservation.startTime.hour,
      minute: reservation.startTime.minute,
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
    if (reservation.depositPaid) return response.badRequest({ message: 'La seña ya fue registrada' })

    const receipt = request.input('receipt', null)
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
    return response.ok(reservation)
  }

  async payTotal({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.depositPaid) return response.badRequest({ message: 'Primero debe registrarse el pago de la seña' })
    if (reservation.totalPaid) return response.badRequest({ message: 'El pago total ya fue registrado' })

    const receipt = request.input('receipt', null)
    reservation.totalPaid = true
    reservation.totalPaidAt = DateTime.now()
    reservation.totalPaidBy = user.id
    reservation.totalPaidCount = (reservation.totalPaidCount || 0) + 1
    if (receipt) reservation.totalReceipt = receipt
    await reservation.save()
    return response.ok(reservation)
  }

  async availability({ request, response }: HttpContext) {
    const courtId = request.input('court_id')
    const date = request.input('date')
    if (!courtId || !date) return response.badRequest({ message: 'Se requiere court_id y date' })

    const queryDate = DateTime.fromISO(date)
    const start = queryDate.startOf('day')
    const end = queryDate.endOf('day')
    const queryWeekday = queryDate.weekday
    const queryDateStr = queryDate.toISODate()!

    const directReservations = await Reservation.query()
      .where('court_id', courtId)
      .whereNot('status', 'cancelled')
      .where('is_recurring', false)
      .where('start_time', '>=', start.toSQL()!)
      .where('start_time', '<=', end.toSQL()!)
      .orderBy('start_time', 'asc')

    const allRecurring = await Reservation.query()
      .where('court_id', courtId)
      .whereNot('status', 'cancelled')
      .where('is_recurring', true)
      .where('start_time', '<=', end.toSQL()!)

    const activeRecurring = allRecurring.filter(r => {
      if (r.startTime.weekday !== queryWeekday) return false
      const hiddenUntilStr = toDateStr(r.hiddenUntil)
      if (hiddenUntilStr && queryDateStr < hiddenUntilStr) return false
      return true
    })

    return response.ok([...directReservations, ...activeRecurring])
  }

  async showNext({ params, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer' || user.role === 'professor') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

    // Find the next occurrence date (same weekday as the recurring reservation, starting from tomorrow)
    const startWeekday = reservation.startTime.weekday
    let next = DateTime.now().startOf('day').plus({ days: 1 })
    while (next.weekday !== startWeekday) {
      next = next.plus({ days: 1 })
    }

    // Build the occurrence start/end times on that date
    const occStart = next.set({ hour: reservation.startTime.hour, minute: reservation.startTime.minute, second: 0, millisecond: 0 })
    const occEnd = occStart.plus({ minutes: Math.round(reservation.endTime.diff(reservation.startTime, 'minutes').minutes) })

    const endSQL = (occEnd.hour === 0 && occEnd.minute === 0)
      ? occStart.endOf('day').toSQL()!
      : occEnd.toSQL()!

    // Check if a direct reservation already occupies this slot
    const conflict = await Reservation.query()
      .where('court_id', reservation.courtId)
      .where('is_recurring', false)
      .whereNot('status', 'cancelled')
      .where('start_time', '<', endSQL)
      .where('end_time', '>', occStart.toSQL()!)
      .first()

    if (conflict) {
      return response.conflict({ message: 'No se puede mostrar: ya existe una reserva en ese horario el próximo ' + next.setLocale('es').toFormat('EEEE d/M') })
    }

    reservation.hiddenUntil = null
    if (reservation.consecutiveGamesSnapshot != null) {
      reservation.consecutiveGames = reservation.consecutiveGamesSnapshot
      reservation.consecutiveGamesSnapshot = null
    }
    await reservation.save()
    return response.ok(reservation)
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
