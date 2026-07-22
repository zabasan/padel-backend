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

    // ── Court revenue = ALL money COLLECTED per court in the period ──
    // Every payment belongs to a reservation, which belongs to a court, so all collected
    // money (including señas of not-yet-saldadas) is attributed to its court. This makes
    // the per-court total equal the "Formas de pago" (caja) total — same money, split by
    // court. The reconciliation below then breaks that total into facturado vs señas.
    // reservation_payments.total is the collected amount; when filtering by payment method
    // we sum that method's column instead.
    // completed_reservations still counts only BILLED items (non-rec total_paid=1;
    // recurring occurrences with a type='total' payment).
    const revenueExpr = paymentMethod === 'efectivo' ? 'rp.efectivo'
      : paymentMethod === 'transferencia' ? 'rp.transferencia'
      : paymentMethod === 'postnet' ? 'rp.postnet'
      : 'rp.total'

    const courtQuery = `
      SELECT
        c.id,
        c.name,
        c.type,
        (COUNT(DISTINCT CASE WHEN r.is_recurring = 0 AND r.total_paid = 1 THEN r.id END)
          + COUNT(DISTINCT CASE WHEN r.is_recurring = 1 AND rp.type = 'total' THEN rp.id END)) AS completed_reservations,
        COALESCE(SUM(${revenueExpr}), 0) AS total_revenue
      FROM courts c
      LEFT JOIN reservations r
        ON r.court_id = c.id
        AND r.status != 'cancelled'
        AND (
          (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
          OR (r.is_recurring = 1 AND EXISTS (
            SELECT 1 FROM reservation_payments rp2
            WHERE rp2.reservation_id = r.id
              AND (
                (rp2.occurrence_date IS NOT NULL AND rp2.occurrence_date >= ? AND rp2.occurrence_date <= ?)
                OR (rp2.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
              )
          ))
        )
      LEFT JOIN reservation_payments rp
        ON rp.reservation_id = r.id
        AND (
          (r.is_recurring = 0)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
        )
      GROUP BY c.id, c.name, c.type
      ORDER BY total_revenue DESC, c.name ASC
    `
    const courtParams = [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL]

    const courts = await db.rawQuery(courtQuery, courtParams)
    const rows = courts[0] as any[]
    const result = rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      completedReservations: Number(r.completed_reservations),
      totalReservations: 0,
      totalRevenue: Number(r.total_revenue),
    }))

    const grandTotal = result.reduce((s, c) => s + c.totalRevenue, 0)

    // ── Total reservations per court: every CONFIRMED reservation in the period, charged
    //    or not (pending / cancelled are excluded). Recurring series count once per VISIBLE
    //    occurrence in the window — same definition the calendar uses: weekly on the series
    //    weekday, on/after the series start, minus any hidden occurrence.
    const totalByCourt: Record<number, number> = {}

    // Non-recurring: one row = one reservation in range.
    const nonRec = await db.rawQuery(
      `SELECT court_id, COUNT(*) AS cnt
       FROM reservations
       WHERE status = 'confirmed' AND is_recurring = 0
         AND start_time >= ? AND start_time <= ?
       GROUP BY court_id`,
      [fromSQL, toSQL]
    )
    for (const row of nonRec[0] as any[]) {
      totalByCourt[row.court_id] = Number(row.cnt)
    }

    // Recurring: fetch every open-ended series whose first occurrence is on/before the
    // window end, then expand its weekly occurrences inside the window (skipping hidden).
    const recRes = await db.rawQuery(
      `SELECT r.id, r.court_id,
         DATE_FORMAT(CONVERT_TZ(r.start_time, '+00:00', '-03:00'), '%Y-%m-%d') AS start_date_art
       FROM reservations r
       WHERE r.status = 'confirmed' AND r.is_recurring = 1
         AND DATE(CONVERT_TZ(r.start_time, '+00:00', '-03:00')) <= ?`,
      [toDate]
    )
    const recRows = recRes[0] as any[]

    if (recRows.length) {
      const ids = recRows.map((r) => r.id)
      const hidRes = await db.rawQuery(
        `SELECT reservation_id, DATE_FORMAT(hidden_date, '%Y-%m-%d') AS d
         FROM reservation_hidden_dates
         WHERE reservation_id IN (${ids.map(() => '?').join(',')})`,
        ids
      )
      const hiddenByRes: Record<number, Set<string>> = {}
      for (const h of hidRes[0] as any[]) {
        ;(hiddenByRes[h.reservation_id] ??= new Set()).add(h.d)
      }

      const fromDay = from.startOf('day')
      for (const r of recRows) {
        const seriesStart = DateTime.fromISO(r.start_date_art, { zone: TZ }).startOf('day')
        const hidden = hiddenByRes[r.id] ?? new Set<string>()

        // Advance to the first occurrence inside the window (weekly cadence from the start).
        let cur = seriesStart
        if (cur < fromDay) {
          const weeks = Math.floor(fromDay.diff(cur, 'weeks').weeks)
          cur = cur.plus({ weeks: Math.max(0, weeks) })
          while (cur < fromDay) cur = cur.plus({ weeks: 1 })
        }

        let count = 0
        while (cur.toISODate()! <= toDate!) {
          if (!hidden.has(cur.toISODate()!)) count++
          cur = cur.plus({ weeks: 1 })
        }
        if (count > 0) totalByCourt[r.court_id] = (totalByCourt[r.court_id] ?? 0) + count
      }
    }

    for (const c of result) {
      c.totalReservations = totalByCourt[c.id] ?? 0
    }

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

    // ── Reconciliation: why "total cobrado" (caja) ≠ "ingresos por cancha" ──
    // The court-revenue total counts only reservations considered billed:
    //   - non-recurring with total_paid = 1
    //   - recurring occurrences that have a type='total' payment for that occurrence_date
    // "Señas sin saldar" = money collected on payment rows whose reservation/occurrence is
    // NOT billed yet (deposits/partials). It's in caja but not in ingresos.
    const senasRes = await db.rawQuery(`
      SELECT COALESCE(SUM(rp.total), 0) AS senas
      FROM reservation_payments rp
      INNER JOIN reservations r ON r.id = rp.reservation_id
      WHERE r.status != 'cancelled'
        AND (
          (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
        )
        AND NOT (
          (r.is_recurring = 0 AND r.total_paid = 1)
          OR (r.is_recurring = 1 AND EXISTS (
            SELECT 1 FROM reservation_payments rpt
            WHERE rpt.reservation_id = r.id
              AND rpt.type = 'total'
              AND (
                (rp.occurrence_date IS NOT NULL AND rpt.occurrence_date = rp.occurrence_date)
                OR (rp.occurrence_date IS NULL AND rpt.occurrence_date IS NULL)
              )
          ))
        )
    `, [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL])
    const senasSinSaldar = Math.round(Number((senasRes[0] as any[])[0]?.senas || 0) * 100) / 100

    // grandTotal now equals the caja total; the reconciliation splits it into facturado
    // (billed reservations) vs señas of not-yet-saldadas. No separate totals:
    //   grandTotal = cajaTotal = facturado + senasSinSaldar
    const cajaTotal = paymentBreakdown.totalPayments
    const facturado = Math.round((grandTotal - senasSinSaldar) * 100) / 100
    const reconciliation = {
      total: grandTotal,
      facturado,
      senasSinSaldar,
      cajaTotal,
    }

    return response.ok({
      period,
      from: from.toISO(),
      to: to.toISO(),
      courts: result,
      grandTotal,
      paymentBreakdown,
      reconciliation,
    })
  }
}
