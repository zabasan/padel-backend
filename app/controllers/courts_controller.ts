import type { HttpContext } from '@adonisjs/core/http'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import vine from '@vinejs/vine'

const courtValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(2).maxLength(100),
    type: vine.enum(['padel', 'football'] as const),
    description: vine.string().trim().optional(),
    pricePerHour: vine.number().positive(),
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
        pricePerHour: vine.number().positive(),
        isPeakHour: vine.boolean().optional(),
      })
    ),
  })
)

export default class CourtsController {
  async index({ response }: HttpContext) {
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

    // Delete existing ranges and recreate
    await CourtPriceRange.query().where('court_id', court.id).delete()

    for (const range of ranges) {
      await CourtPriceRange.create({ courtId: court.id, ...range })
    }

    await court.load('priceRanges')
    return response.ok(court)
  }
}
