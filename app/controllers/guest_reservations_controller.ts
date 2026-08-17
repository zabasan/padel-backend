import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import Reservation from '#models/reservation'
import Court from '#models/court'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import { calculateCourtPrice } from '#services/court_pricing'
import { serializeSessionUser } from '#transformers/user_session'

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

    const totalPrice = calculateCourtPrice(court, court.priceRanges, start, end)

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
      user: await serializeSessionUser(user),
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
