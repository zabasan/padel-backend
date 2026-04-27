import type { HttpContext } from '@adonisjs/core/http'
import UserAuditLog from '#models/user_audit_log'

export default class UserAuditLogsController {
  async index({ response }: HttpContext) {
    const logs = await UserAuditLog.query()
      .preload('performer', q => q.select(['id', 'full_name', 'phone', 'role']))
      .preload('targetUser', q => q.select(['id', 'full_name', 'phone', 'role']))
      .orderBy('created_at', 'desc')
      .limit(500)

    return response.ok(logs)
  }
}
