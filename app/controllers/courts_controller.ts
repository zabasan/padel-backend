import type { HttpContext } from '@adonisjs/core/http'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import CourtPriceHistory from '#models/court_price_history'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'

const courtValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(100),
    type: vine.enum(['padel', 'football'] as const),
    description: vine.string().trim().optional(),
    pricePerHour: vine.number().positive(),
    // `nullable` a propósito: mandar null es como se LIMPIA el override para que la
    // cancha vuelva a tomar la seña global de Ajustes.
    depositPercentage: vine.number().min(0).max(100).optional().nullable(),
    isActive: vine.boolean().optional(),
    parentCourtId: vine.number().positive().optional().nullable(),
  })
)

const priceRangeValidator = vine.compile(
  vine.object({
    ranges: vine.array(
      vine.object({
        startHour: vine.number().min(0).max(23),
        endHour: vine.number().min(1).max(24),
        pricePerHour: vine.number().min(0),
        isPeakHour: vine.boolean().optional(),
        price60Min: vine.number().min(0).optional().nullable(),
        price90Min: vine.number().min(0).optional().nullable(),
        price120Min: vine.number().min(0).optional().nullable(),
      })
    ),
  })
)

export default class CourtsController {
  async index({ request, response }: HttpContext) {
    if (request.input('summary') === 'true') {
      const courts = await Court.query().select('id', 'name')
      return response.ok(courts)
    }
    const courts = await Court.query().preload('priceRanges').preload('subCourts')
    return response.ok(courts)
  }

  async show({ params, response }: HttpContext) {
    const court = await Court.query().where('id', params.id).preload('priceRanges').firstOrFail()
    return response.ok(court)
  }

  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(courtValidator)
    const court = await Court.create(data)
    return response.created(court)
  }

  async update({ params, request, response }: HttpContext) {
    const court = await Court.findOrFail(params.id)
    const data = await request.validateUsing(courtValidator)
    court.merge(data)
    await court.save()
    await court.load('priceRanges')
    return response.ok(court)
  }

  async destroy({ params, response }: HttpContext) {
    const court = await Court.findOrFail(params.id)
    await court.delete()
    return response.ok({ message: 'Cancha eliminada correctamente' })
  }

  async toggleActive({ params, response }: HttpContext) {
    const court = await Court.findOrFail(params.id)
    court.isActive = !court.isActive
    await court.save()
    return response.ok(court)
  }

  async updatePriceRanges({ params, request, response }: HttpContext) {
    const court = await Court.findOrFail(params.id)
    const { ranges } = await request.validateUsing(priceRangeValidator)

    await CourtPriceRange.query().where('court_id', court.id).delete()

    const effectiveFrom = DateTime.now()
    for (const range of ranges) {
      await CourtPriceRange.create({
        courtId: court.id,
        startHour: range.startHour,
        endHour: range.endHour,
        pricePerHour: range.pricePerHour,
        isPeakHour: range.isPeakHour ?? false,
        price60Min: range.price60Min ?? null,
        price90Min: range.price90Min ?? null,
        price120Min: range.price120Min ?? null,
      })

      await CourtPriceHistory.create({
        courtId: court.id,
        effectiveFrom,
        startHour: range.startHour,
        endHour: range.endHour,
        pricePerHour: range.pricePerHour,
        isPeakHour: range.isPeakHour ?? false,
        price60Min: range.price60Min ?? null,
        price90Min: range.price90Min ?? null,
        price120Min: range.price120Min ?? null,
      })
    }

    await court.load('priceRanges')
    return response.ok(court)
  }
}
