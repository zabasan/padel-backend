import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import Reservation from '#models/reservation'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const guestReservationValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim(),
    phone: vine.string().trim().minLength(6),
    courtId: vine.number().positive(),
    startTime: vine.string(),
    duration: vine.number().min(30).max(480),
    notes: vine.string().trim().optional(),
    padelCategory: vine.enum(['C1','C2','C3','C4','C5','C6','C7','C8','C9'] as const).optional().nullable(),
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

export default class GuestReservationsController {
  async store({ request, response }: HttpContext) {
    const { fullName, phone, courtId, startTime, duration, notes, padelCategory } =
      await request.validateUsing(guestReservationValidator)

    // Find or create customer by phone
    let user = await User.query()
      .where('phone', phone)
      .orWhere('phone', 'like', `%${phone.slice(-8)}`)
      .first()

    if (user && (user.status ?? 'active') === 'inactive') {
      return response.forbidden({ message: 'Tu cuenta está desactivada. Contactá al administrador.' })
    }

    if (!user) {
      user = await User.create({
        fullName,
        phone,
        role: 'customer',
        password: phone,
        email: `${phone}@padel.temp`,
        hasLoggedIn: false,
        padelCategory: padelCategory ?? null,
      })
    } else {
      let changed = false
      if (!user.fullName) { user.fullName = fullName; changed = true }
      if (padelCategory && !user.padelCategory) { user.padelCategory = padelCategory; changed = true }
      if (changed) await user.save()
    }

    const start = DateTime.fromISO(startTime)
    if (!start.isValid) {
      return response.badRequest({ message: 'Horario inválido' })
    }
    const end = start.plus({ minutes: duration })

    const court = await Court.query()
      .where('id', courtId)
      .preload('priceRanges')
      .firstOrFail()

    // Basic conflict check
    const conflicts = await Reservation.query()
      .where('courtId', courtId)
      .whereNot('status', 'cancelled')
      .where(q => {
        q.where(q2 => {
          q2.where('startTime', '<', end.toSQL()!).where('endTime', '>', start.toSQL()!)
        })
      })

    if (conflicts.length > 0) {
      return response.conflict({ message: 'La cancha ya está reservada en ese horario' })
    }

    const totalPrice = calculatePrice(court.priceRanges, Number(court.pricePerHour), start, end)

    const reservation = await Reservation.create({
      courtId,
      userId: user.id,
      startTime: start,
      endTime: end,
      contactPhone: phone,
      notes: notes ?? null,
      status: 'pending',
      totalPrice,
      isRecurring: false,
    })

    const token = await User.accessTokens.create(user)

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        padelCategory: user.padelCategory,
        hasLoggedIn: user.hasLoggedIn,
      },
      token: token.value!.release(),
      reservation: {
        id: reservation.id,
        courtId: reservation.courtId,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        status: reservation.status,
        totalPrice: reservation.totalPrice,
      },
    }
  }
}
