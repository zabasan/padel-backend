import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

export default class StatsController {
  async index({ request, response }: HttpContext) {
    const period = request.input('period', 'month')  // 'day' | 'month' | 'year'
    const date = request.input('date', '')
    const paymentMethod = request.input('paymentMethod', '') // 'efectivo' | 'transferencia' | 'postnet' | ''

    let from: DateTime
    let to: DateTime
    const TZ = 'America/Argentina/Buenos_Aires'
    const now = DateTime.now().setZone(TZ)

    if (period === 'day') {
      const d = date ? DateTime.fromISO(date, { zone: TZ }) : now
      from = d.startOf('day')
      to = d.endOf('day')
    } else if (period === 'month') {
      const d = date ? DateTime.fromFormat(date, 'yyyy-MM', { zone: TZ }) : now
      from = d.startOf('month')
      to = d.endOf('month')
    } else {
      const year = date ? parseInt(date) : now.year
      from = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: TZ }).startOf('day')
      to = DateTime.fromObject({ year, month: 12, day: 31 }, { zone: TZ }).endOf('day')
    }

    const fromSQL = from.toUTC().toSQL()
    const toSQL = to.toUTC().toSQL()

    // ── Court revenue (unchanged logic, filter by payment method if needed) ──
    let courtQuery: string
    let courtParams: any[]

    if (paymentMethod) {
      // When filtering by payment method, revenue comes from payment records only
      courtQuery = `
        SELECT
          c.id,
          c.name,
          c.type,
          COALESCE(COUNT(DISTINCT r.id), 0) AS completed_reservations,
          COALESCE(SUM(rp.${paymentMethod === 'efectivo' ? 'efectivo' : paymentMethod === 'transferencia' ? 'transferencia' : 'postnet'}), 0) AS total_revenue
        FROM courts c
        LEFT JOIN reservations r
          ON r.court_id = c.id
          AND r.status != 'cancelled'
          AND r.start_time >= ?
          AND r.start_time <= ?
        LEFT JOIN reservation_payments rp
          ON rp.reservation_id = r.id
        WHERE c.id IS NOT NULL
        GROUP BY c.id, c.name, c.type
        ORDER BY total_revenue DESC, c.name ASC
      `
      courtParams = [fromSQL, toSQL]
    } else {
      courtQuery = `
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
      `
      courtParams = [fromSQL, toSQL]
    }

    const courts = await db.rawQuery(courtQuery, courtParams)
    const rows = courts[0] as any[]
    const result = rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      completedReservations: Number(r.completed_reservations),
      totalRevenue: Number(r.total_revenue),
    }))

    const grandTotal = result.reduce((s, c) => s + c.totalRevenue, 0)

    // ── Payment method breakdown from reservation_payments table ──
    const breakdown = await db.rawQuery(`
      SELECT
        COALESCE(SUM(rp.efectivo), 0)      AS efectivo,
        COALESCE(SUM(rp.transferencia), 0) AS transferencia,
        COALESCE(SUM(rp.postnet), 0)       AS postnet,
        COALESCE(SUM(rp.total), 0)         AS total_payments,
        COUNT(rp.id)                        AS payment_count
      FROM reservation_payments rp
      INNER JOIN reservations r ON r.id = rp.reservation_id
      WHERE r.status != 'cancelled'
        AND r.start_time >= ?
        AND r.start_time <= ?
    `, [fromSQL, toSQL])

    const bRow = (breakdown[0] as any[])[0] || {}
    const paymentBreakdown = {
      efectivo: Math.round(Number(bRow.efectivo) * 100) / 100,
      transferencia: Math.round(Number(bRow.transferencia) * 100) / 100,
      postnet: Math.round(Number(bRow.postnet) * 100) / 100,
      totalPayments: Math.round(Number(bRow.total_payments) * 100) / 100,
      paymentCount: Number(bRow.payment_count),
    }

    return response.ok({
      period,
      from: from.toISO(),
      to: to.toISO(),
      courts: result,
      grandTotal,
      paymentBreakdown,
    })
  }
}
