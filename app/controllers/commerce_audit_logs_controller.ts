import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import CommerceAuditLog from '#models/commerce_audit_log'

const ART_TZ = 'America/Argentina/Buenos_Aires'

/**
 * Read side of commerce_audit_logs. Response shape is deliberately identical to
 * user_audit_logs_controller's ({ data, meta }) so AuditPage can render a third tab without a
 * second pagination contract.
 */
export default class CommerceAuditLogsController {
  async index({ request, response }: HttpContext) {
    const currentPage = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(200, Math.max(1, Number(request.input('perPage', 50)) || 50))
    const performedBy = Number(request.input('performedBy')) || 0
    const entityType = String(request.input('entityType') ?? '').trim()
    const date = String(request.input('date') ?? '').trim()

    let query = CommerceAuditLog.query()
      .preload('performer', (p) => p.select(['id', 'full_name', 'phone', 'role']))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')

    if (performedBy) query = query.where('performed_by', performedBy)
    if (['product', 'category', 'sale'].includes(entityType)) {
      query = query.where('entity_type', entityType)
    }
    if (date) {
      const day = DateTime.fromISO(date, { zone: ART_TZ })
      if (day.isValid) {
        query = query
          .where('created_at', '>=', day.startOf('day').toUTC().toSQL()!)
          .where('created_at', '<=', day.endOf('day').toUTC().toSQL()!)
      }
    }

    const paginator = await query.paginate(currentPage, perPage)
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
