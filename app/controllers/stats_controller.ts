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
    const fromDate = from.toISODate()  // YYYY-MM-DD for occurrence_date comparisons
    const toDate = to.toISODate()

    // ── Court revenue ──
    // Non-recurring: use stored total_price (when total_paid or deposit_paid).
    // Recurring: use historical price per paid occurrence (by occurrence_date).
    //   - Payments with occurrence_date in range → price from court_price_history at that date.
    //   - Payments without occurrence_date (pre-migration) → fall back to stored total_price.

    let courtQuery: string
    let courtParams: any[]

    if (paymentMethod) {
      // When filtering by payment method, revenue comes only from payment records
      const col = paymentMethod === 'efectivo' ? 'rp.efectivo'
        : paymentMethod === 'transferencia' ? 'rp.transferencia'
        : 'rp.postnet'

      courtQuery = `
        SELECT
          c.id,
          c.name,
          c.type,
          COALESCE(COUNT(DISTINCT r.id), 0) AS completed_reservations,
          COALESCE(SUM(${col}), 0) AS total_revenue
        FROM courts c
        LEFT JOIN reservations r
          ON r.court_id = c.id
          AND r.status != 'cancelled'
        LEFT JOIN reservation_payments rp
          ON rp.reservation_id = r.id
          AND rp.type = 'total'
          AND (
            (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
            OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
            OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
          )
        WHERE c.id IS NOT NULL
        GROUP BY c.id, c.name, c.type
        ORDER BY total_revenue DESC, c.name ASC
      `
      courtParams = [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL]
    } else {
      // Without payment method filter: compute historical price for recurring paid occurrences
      courtQuery = `
        SELECT
          c.id,
          c.name,
          c.type,
          COALESCE(COUNT(DISTINCT r.id), 0) AS completed_reservations,
          COALESCE(
            SUM(
              CASE
                -- Non-recurring: use stored total_price when paid
                WHEN r.is_recurring = 0 AND r.total_paid = 1 THEN r.total_price
                -- Recurring with occurrence_date: look up historical price for that date
                WHEN r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL THEN (
                  SELECT
                    COALESCE(
                      -- Padel: match the occurrence start hour to price range, then apply the reservation's discount
                      (SELECT
                        CASE
                          WHEN TIME_TO_SEC(CONVERT_TZ(r.start_time, '+00:00', '-03:00')) / 3600 < cph2.end_hour
                            AND TIME_TO_SEC(CONVERT_TZ(r.start_time, '+00:00', '-03:00')) / 3600 >= cph2.start_hour
                          THEN
                            (CASE
                              WHEN TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) = 60 AND cph2.price_60_min IS NOT NULL THEN cph2.price_60_min
                              WHEN TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) = 90 AND cph2.price_90_min IS NOT NULL THEN cph2.price_90_min
                              WHEN TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) = 120 AND cph2.price_120_min IS NOT NULL THEN cph2.price_120_min
                              ELSE cph2.price_per_hour * TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) / 60
                            END) * (1 - r.discount_percentage / 100)
                          ELSE NULL
                        END
                        FROM court_price_history cph2
                        WHERE cph2.court_id = r.court_id
                          AND cph2.effective_from = (
                            SELECT MAX(cph3.effective_from)
                            FROM court_price_history cph3
                            WHERE cph3.court_id = r.court_id
                              AND cph3.effective_from <= CONCAT(rp.occurrence_date, 'T00:00:00.000Z')
                          )
                          AND TIME_TO_SEC(CONVERT_TZ(r.start_time, '+00:00', '-03:00')) / 3600 >= cph2.start_hour
                          AND TIME_TO_SEC(CONVERT_TZ(r.start_time, '+00:00', '-03:00')) / 3600 < cph2.end_hour
                        LIMIT 1
                      ),
                      -- Fallback: stored total_price
                      r.total_price
                    )
                )
                -- Recurring without occurrence_date (pre-migration): use stored total_price
                WHEN r.is_recurring = 1 AND rp.occurrence_date IS NULL THEN r.total_price
                ELSE 0
              END
            ),
            0
          ) AS total_revenue
        FROM courts c
        LEFT JOIN reservations r
          ON r.court_id = c.id
          AND r.status != 'cancelled'
          AND (
            (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
            OR (r.is_recurring = 1 AND EXISTS (
              SELECT 1 FROM reservation_payments rp2
              WHERE rp2.reservation_id = r.id
                AND rp2.type = 'total'
                AND (
                  (rp2.occurrence_date IS NOT NULL AND rp2.occurrence_date >= ? AND rp2.occurrence_date <= ?)
                  OR (rp2.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
                )
            ))
          )
        LEFT JOIN reservation_payments rp
          ON rp.reservation_id = r.id
          AND rp.type = 'total'
          AND (
            (r.is_recurring = 0)
            OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
            OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
          )
        GROUP BY c.id, c.name, c.type
        ORDER BY total_revenue DESC, c.name ASC
      `
      courtParams = [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL]
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
        AND (
          (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
        )
    `, [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL])

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
