import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

export default class StatsController {
  async index({ request, response }: HttpContext) {
    const period = request.input('period', 'month')  // 'day' | 'month' | 'year'
    const date = request.input('date', '')

    let from: DateTime
    let to: DateTime
    const now = DateTime.now()

    if (period === 'day') {
      const d = date ? DateTime.fromISO(date) : now
      from = d.startOf('day')
      to = d.endOf('day')
    } else if (period === 'month') {
      const d = date ? DateTime.fromFormat(date, 'yyyy-MM') : now
      from = d.startOf('month')
      to = d.endOf('month')
    } else {
      // year
      const year = date ? parseInt(date) : now.year
      from = DateTime.local(year, 1, 1).startOf('day')
      to = DateTime.local(year, 12, 31).endOf('day')
    }

    const courts = await db.rawQuery(`
      SELECT
        c.id,
        c.name,
        c.type,
        COALESCE(COUNT(r.id), 0) AS completed_reservations,
        COALESCE(SUM(
          CASE
            WHEN r.is_recurring = 1 THEN r.total_paid_count * r.total_price
            WHEN r.total_paid = 1 THEN r.total_price
            ELSE 0
          END
        ), 0) AS total_revenue
      FROM courts c
      LEFT JOIN reservations r
        ON r.court_id = c.id
        AND r.status != 'cancelled'
        AND r.start_time >= ?
        AND r.start_time <= ?
      GROUP BY c.id, c.name, c.type
      ORDER BY total_revenue DESC, c.name ASC
    `, [from.toSQL(), to.toSQL()])

    const rows = courts[0] as any[]
    const result = rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      completedReservations: Number(r.completed_reservations),
      totalRevenue: Number(r.total_revenue),
    }))

    const grandTotal = result.reduce((s, c) => s + c.totalRevenue, 0)

    return response.ok({
      period,
      from: from.toISO(),
      to: to.toISO(),
      courts: result,
      grandTotal,
    })
  }
}
