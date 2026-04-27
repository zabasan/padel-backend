import type { HttpContext } from '@adonisjs/core/http'
import Reservation from '#models/reservation'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const reservationValidator = vine.compile(
  vine.object({
    courtId: vine.number().positive(),
    startTime: vine.string(),
    endTime: vine.string(),
    contactPhone: vine.string().trim().optional(),
    notes: vine.string().trim().optional(),
    customerId: vine.number().positive().optional(),
    isRecurring: vine.boolean().optional(),
    depositPercentage: vine.number().min(0).max(100).optional(),
  })
)

function calculatePrice(priceRanges: CourtPriceRange[], defaultPrice: number, start: DateTime, end: DateTime): number {
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

function timeInMinutes(dt: DateTime): number {
  return dt.hour * 60 + dt.minute
}

// MySQL returns DATE columns as JS Date objects or full ISO strings — normalize to "YYYY-MM-DD"
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

    // Time overlap — check if this occurrence is hidden
    const hiddenUntilStr = toDateStr(r.hiddenUntil)
    if (hiddenUntilStr && startDateISO < hiddenUntilStr) continue

    return true
  }
  return false
}

export default class ReservationsController {
  async index({ auth, request, response }: HttpContext) {
    const user = auth.user!
    const from = request.input('from')
    const to = request.input('to')

    let query = Reservation.query().preload('court').preload('user').preload('customer')

    if (user.role === 'customer') {
      query = query.where('user_id', user.id)
    }

    if (from) query = query.where('start_time', '>=', DateTime.fromISO(from).startOf('day').toSQL()!)
    if (to) query = query.where('start_time', '<=', DateTime.fromISO(to).endOf('day').toSQL()!)

    const reservations = await query.orderBy('start_time', 'asc')
    return response.ok(reservations)
  }

  async show({ params, auth, response }: HttpContext) {
    const user = auth.user!
    const reservation = await Reservation.query()
      .where('id', params.id)
      .preload('court')
      .preload('user')
      .preload('customer')
      .firstOrFail()

    if (user.role === 'customer' && reservation.userId !== user.id) {
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
    const endTime = DateTime.fromISO(data.endTime)

    if (endTime <= startTime) {
      return response.badRequest({ message: 'La hora de fin debe ser posterior a la hora de inicio' })
    }

    const endSQL = (endTime.hour === 0 && endTime.minute === 0)
      ? DateTime.fromISO(data.startTime).endOf('day').toSQL()!
      : endTime.toSQL()!
    const startSQL = startTime.toSQL()!

    // Conflict check 1 — direct non-recurring conflict on same court
    const directConflict = await Reservation.query()
      .where('court_id', data.courtId)
      .where('is_recurring', false)
      .whereNot('status', 'cancelled')
      .where('start_time', '<', endSQL)
      .where('end_time', '>', startSQL)
      .first()

    if (directConflict) {
      return response.conflict({ message: 'La cancha ya está reservada en ese horario' })
    }

    // Conflict check 2 — recurring conflict on same court
    const recurringOnCourt = await Reservation.query()
      .where('court_id', data.courtId)
      .where('is_recurring', true)
      .whereNot('status', 'cancelled')

    if (hasRecurringConflict(recurringOnCourt, startTime, endTime)) {
      return response.conflict({ message: 'La cancha ya está reservada en ese horario (reserva recurrente)' })
    }

    // Conflict check 3 — parent/sub-court conflict
    const relatedCourtIds: number[] = []

    if (court.parentCourtId) {
      relatedCourtIds.push(court.parentCourtId)
      const siblings = await Court.query()
        .where('parent_court_id', court.parentCourtId)
        .whereNot('id', court.id)
      for (const s of siblings) relatedCourtIds.push(s.id)
    }

    if (court.subCourts.length > 0) {
      for (const sc of court.subCourts) relatedCourtIds.push(sc.id)
    }

    if (relatedCourtIds.length > 0) {
      // Non-recurring conflicts on related courts
      const relatedDirectConflict = await Reservation.query()
        .whereIn('court_id', relatedCourtIds)
        .where('is_recurring', false)
        .whereNot('status', 'cancelled')
        .where('start_time', '<', endSQL)
        .where('end_time', '>', startSQL)
        .first()

      if (relatedDirectConflict) {
        const isParentConflict = relatedDirectConflict.courtId === court.parentCourtId
        const msg = isParentConflict
          ? 'No se puede reservar: la cancha completa ya está reservada en ese horario'
          : 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas'
        return response.conflict({ message: msg })
      }

      // Recurring conflicts on related courts
      const relatedRecurring = await Reservation.query()
        .whereIn('court_id', relatedCourtIds)
        .where('is_recurring', true)
        .whereNot('status', 'cancelled')

      if (relatedRecurring.length > 0) {
        const parentRecurring = relatedRecurring.filter((r) => r.courtId === court.parentCourtId)
        const subRecurring = relatedRecurring.filter((r) => r.courtId !== court.parentCourtId)

        if (parentRecurring.length > 0 && hasRecurringConflict(parentRecurring, startTime, endTime)) {
          return response.conflict({ message: 'No se puede reservar: la cancha completa ya está reservada en ese horario' })
        }
        if (subRecurring.length > 0 && hasRecurringConflict(subRecurring, startTime, endTime)) {
          return response.conflict({ message: 'No se puede reservar la cancha completa: una o más canchas divisibles ya están reservadas' })
        }
      }
    }

    const totalPrice = calculatePrice(court.priceRanges, court.pricePerHour, startTime, endTime)

    let userId = user.id
    if ((user.role === 'admin' || user.role === 'worker') && data.customerId) {
      userId = data.customerId
    }

    const reservation = await Reservation.create({
      courtId: data.courtId,
      userId,
      startTime,
      endTime,
      contactPhone: data.contactPhone,
      notes: data.notes,
      totalPrice,
      status: 'pending',
      isRecurring: data.isRecurring ?? false,
      depositPercentage: data.depositPercentage != null ? data.depositPercentage : null,
      depositPaid: false,
      totalPaid: false,
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

    if (user.role === 'admin' || user.role === 'worker') {
      const status = request.input('status')
      if (status && ['pending', 'confirmed', 'cancelled'].includes(status)) {
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
    }

    if (reservation.status !== 'pending') {
      return response.badRequest({ message: 'Solo se pueden modificar reservas pendientes' })
    }

    const data = await request.validateUsing(reservationValidator)
    const court = await Court.query().where('id', data.courtId).preload('priceRanges').first()
    if (!court) return response.notFound({ message: 'Cancha no encontrada' })

    const startTime = DateTime.fromISO(data.startTime)
    const endTime = DateTime.fromISO(data.endTime)
    const totalPrice = calculatePrice(court.priceRanges, court.pricePerHour, startTime, endTime)

    reservation.merge({ courtId: data.courtId, startTime, endTime, contactPhone: data.contactPhone, notes: data.notes, totalPrice })
    await reservation.save()
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
    if (user.role === 'customer') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.isRecurring) return response.badRequest({ message: 'La reserva no es recurrente' })

    const startWeekday = reservation.startTime.weekday
    let next = DateTime.now().startOf('day').plus({ days: 1 })
    while (next.weekday !== startWeekday) {
      next = next.plus({ days: 1 })
    }

    reservation.hiddenUntil = next.plus({ days: 1 }).toISODate()!
    await reservation.save()
    return response.ok(reservation)
  }

  async payDeposit({ params, request, auth, response }: HttpContext) {
    const user = auth.user!
    if (user.role === 'customer') return response.forbidden({ message: 'Sin permisos' })

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
    if (user.role === 'customer') return response.forbidden({ message: 'Sin permisos' })

    const reservation = await Reservation.findOrFail(params.id)
    if (!reservation.depositPaid) return response.badRequest({ message: 'Primero debe registrarse el pago de la seña' })
    if (reservation.totalPaid) return response.badRequest({ message: 'El pago total ya fue registrado' })

    const receipt = request.input('receipt', null)
    reservation.totalPaid = true
    reservation.totalPaidAt = DateTime.now()
    reservation.totalPaidBy = user.id
    if (receipt) reservation.totalReceipt = receipt
    await reservation.save()
    return response.ok(reservation)
  }

  async availability({ request, response }: HttpContext) {
    const courtId = request.input('court_id')
    const date = request.input('date')
    if (!courtId || !date) return response.badRequest({ message: 'Se requiere court_id y date' })

    const start = DateTime.fromISO(date).startOf('day')
    const end = DateTime.fromISO(date).endOf('day')

    const reservations = await Reservation.query()
      .where('court_id', courtId)
      .whereNot('status', 'cancelled')
      .where('start_time', '>=', start.toSQL()!)
      .where('start_time', '<=', end.toSQL()!)
      .orderBy('start_time', 'asc')

    return response.ok(reservations)
  }
}
