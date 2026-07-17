import type { HttpContext } from '@adonisjs/core/http'
import UserAuditLog from '#models/user_audit_log'

export default class UserAuditLogsController {
  async index({ request, response }: HttpContext) {
    const currentPage = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(200, Math.max(1, Number(request.input('perPage', 50)) || 50))
    const search = String(request.input('search') ?? '').trim()

    let q = UserAuditLog.query()
      .preload('performer', p => p.select(['id', 'full_name', 'phone', 'role']))
      .preload('targetUser', t => t.select(['id', 'full_name', 'phone', 'role']))
      .orderBy('created_at', 'desc')

    if (search) {
      const like = `%${search}%`
      q = q.where(sub => {
        sub.whereHas('performer', p => p.where('full_name', 'like', like))
          .orWhereHas('targetUser', t => t.where('full_name', 'like', like))
          .orWhere('field', 'like', like)
          .orWhere('old_value', 'like', like)
          .orWhere('new_value', 'like', like)
      })
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
