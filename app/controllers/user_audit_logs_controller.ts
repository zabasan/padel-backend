import type { HttpContext } from '@adonisjs/core/http'
import UserAuditLog from '#models/user_audit_log'
import { DateTime } from 'luxon'

const ART_TZ = 'America/Argentina/Buenos_Aires'

export default class UserAuditLogsController {
  async index({ request, response }: HttpContext) {
    const currentPage = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(200, Math.max(1, Number(request.input('perPage', 50)) || 50))
    const performedBy = Number(request.input('performedBy')) || 0
    const targetUserId = Number(request.input('targetUserId')) || 0
    const date = String(request.input('date') ?? '').trim()

    let q = UserAuditLog.query()
      .preload('performer', p => p.select(['id', 'full_name', 'phone', 'role']))
      .preload('targetUser', t => t.select(['id', 'full_name', 'phone', 'role']))
      .orderBy('created_at', 'desc')

    if (performedBy) q = q.where('performed_by', performedBy)
    if (targetUserId) q = q.where('target_user_id', targetUserId)
    if (date) {
      const day = DateTime.fromISO(date, { zone: ART_TZ })
      if (day.isValid) {
        q = q.where('created_at', '>=', day.startOf('day').toUTC().toSQL()!)
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
