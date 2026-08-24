import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { can, getRequestPermissions } from '#services/permissions'

export default class StatsController {
  async index(ctx: HttpContext) {
    const { request, response } = ctx
    const period = request.input('period', 'month') // 'day' | 'month' | 'year'
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
      const year = date ? Number.parseInt(date) : now.year
      from = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: TZ }).startOf('day')
      to = DateTime.fromObject({ year, month: 12, day: 31 }, { zone: TZ }).endOf('day')
    }

    const fromSQL = from.toUTC().toSQL()
    const toSQL = to.toUTC().toSQL()
    const fromDate = from.toISODate() // YYYY-MM-DD for occurrence_date comparisons
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
    const revenueExpr =
      paymentMethod === 'efectivo'
        ? 'rp.efectivo'
        : paymentMethod === 'transferencia'
          ? 'rp.transferencia'
          : paymentMethod === 'postnet'
            ? 'rp.postnet'
            : 'rp.total'

    const courtQuery = `
      SELECT
        c.id,
        c.name,
        c.type,
        (COUNT(DISTINCT CASE WHEN r.is_recurring = 0 AND r.total_paid = 1 THEN r.id END)
          + COUNT(DISTINCT CASE WHEN r.is_recurring = 1 AND rp.type = 'total' THEN rp.id END)) AS completed_reservations,
        COALESCE(SUM(${revenueExpr}), 0) AS total_revenue,
        COALESCE(SUM(
          CASE WHEN (
            (r.is_recurring = 0 AND r.total_paid = 1)
            OR (r.is_recurring = 1 AND EXISTS (
              SELECT 1 FROM reservation_payments rpt
              WHERE rpt.reservation_id = r.id
                AND rpt.reverted_at IS NULL
                AND rpt.type = 'total'
                AND (
                  (rp.occurrence_date IS NOT NULL AND rpt.occurrence_date = rp.occurrence_date)
                  OR (rp.occurrence_date IS NULL AND rpt.occurrence_date IS NULL)
                )
            ))
          ) THEN ${revenueExpr} ELSE 0 END
        ), 0) AS billed_revenue
      FROM courts c
      LEFT JOIN reservations r
        ON r.court_id = c.id
        AND r.status != 'cancelled'
        AND (
          (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
          OR (r.is_recurring = 1 AND EXISTS (
            SELECT 1 FROM reservation_payments rp2
            WHERE rp2.reservation_id = r.id
              AND rp2.reverted_at IS NULL
              AND (
                (rp2.occurrence_date IS NOT NULL AND rp2.occurrence_date >= ? AND rp2.occurrence_date <= ?)
                OR (rp2.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
              )
          ))
        )
      LEFT JOIN reservation_payments rp
        ON rp.reservation_id = r.id
        AND rp.reverted_at IS NULL
        AND (
          (r.is_recurring = 0)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
        )
      GROUP BY c.id, c.name, c.type
      ORDER BY total_revenue DESC, c.name ASC
    `
    const courtParams = [
      fromSQL,
      toSQL,
      fromDate,
      toDate,
      fromSQL,
      toSQL,
      fromDate,
      toDate,
      fromSQL,
      toSQL,
    ]

    const courts = await db.rawQuery(courtQuery, courtParams)
    const rows = courts[0] as any[]
    const result = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      completedReservations: Number(r.completed_reservations),
      totalReservations: 0,
      totalRevenue: Number(r.total_revenue),
      billedRevenue: Number(r.billed_revenue),
      senaRevenue: Math.round((Number(r.total_revenue) - Number(r.billed_revenue)) * 100) / 100,
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
    const breakdown = await db.rawQuery(
      `
      SELECT
        COALESCE(SUM(rp.efectivo), 0)      AS efectivo,
        COALESCE(SUM(rp.transferencia), 0) AS transferencia,
        COALESCE(SUM(rp.postnet), 0)       AS postnet,
        COALESCE(SUM(rp.total), 0)         AS total_payments,
        COUNT(rp.id)                        AS payment_count
      FROM reservation_payments rp
      INNER JOIN reservations r ON r.id = rp.reservation_id
      WHERE r.status != 'cancelled'
        AND rp.reverted_at IS NULL
        AND (
          (r.is_recurring = 0 AND r.start_time >= ? AND r.start_time <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NOT NULL AND rp.occurrence_date >= ? AND rp.occurrence_date <= ?)
          OR (r.is_recurring = 1 AND rp.occurrence_date IS NULL AND r.start_time >= ? AND r.start_time <= ?)
        )
    `,
      [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL]
    )

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
    const senasRes = await db.rawQuery(
      `
      SELECT COALESCE(SUM(rp.total), 0) AS senas
      FROM reservation_payments rp
      INNER JOIN reservations r ON r.id = rp.reservation_id
      WHERE r.status != 'cancelled'
        AND rp.reverted_at IS NULL
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
              AND rpt.reverted_at IS NULL
              AND rpt.type = 'total'
              AND (
                (rp.occurrence_date IS NOT NULL AND rpt.occurrence_date = rp.occurrence_date)
                OR (rp.occurrence_date IS NULL AND rpt.occurrence_date IS NULL)
              )
          ))
        )
    `,
      [fromSQL, toSQL, fromDate, toDate, fromSQL, toSQL]
    )
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

    // ── Shop revenue (commerce module) ─────────────────────────────────────
    // Kept as its OWN block instead of being folded into paymentBreakdown/reconciliation.
    // Those two carry an invariant — grandTotal = cajaTotal = facturado + senasSinSaldar —
    // that is about court money only; adding shop sales into them would make the
    // reconciliation stop reconciling. The combined register is exposed explicitly as
    // `cajaGeneral` below instead of being smuggled into the court numbers.
    //
    // Cancelled sales are excluded everywhere here: a voided ticket collected nothing.
    // Sales are filtered on created_at — a shop sale happens when it is rung up, with none of
    // the occurrence_date subtlety that recurring reservations have.
    const salesExpr =
      paymentMethod === 'efectivo'
        ? 's.efectivo'
        : paymentMethod === 'transferencia'
          ? 's.transferencia'
          : paymentMethod === 'postnet'
            ? 's.postnet'
            : 's.total'

    const commerceRes = await db.rawQuery(
      `
      SELECT
        COALESCE(SUM(${salesExpr}), 0)  AS total,
        COALESCE(SUM(s.efectivo), 0)      AS efectivo,
        COALESCE(SUM(s.transferencia), 0) AS transferencia,
        COALESCE(SUM(s.postnet), 0)       AS postnet,
        COUNT(s.id)                       AS sales_count
      FROM sales s
      WHERE s.status = 'completed'
        AND s.created_at >= ? AND s.created_at <= ?
    `,
      [fromSQL, toSQL]
    )
    const cRow = (commerceRes[0] as any[])[0] || {}

    // Units, cost and margin come from sale_items, which snapshots unit_cost at sale time —
    // margin has to be computed against what the product cost THEN, not what it costs today.
    const commerceItemsRes = await db.rawQuery(
      `
      SELECT
        COALESCE(SUM(si.quantity), 0)                    AS units,
        COALESCE(SUM(si.unit_cost * si.quantity), 0)     AS cost
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      WHERE s.status = 'completed'
        AND s.created_at >= ? AND s.created_at <= ?
    `,
      [fromSQL, toSQL]
    )
    const ciRow = (commerceItemsRes[0] as any[])[0] || {}

    const topProductsRes = await db.rawQuery(
      `
      SELECT
        si.product_id                                AS product_id,
        si.product_name                              AS product_name,
        SUM(si.quantity)                             AS units,
        SUM(si.subtotal)                             AS revenue
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      WHERE s.status = 'completed'
        AND s.created_at >= ? AND s.created_at <= ?
      GROUP BY si.product_id, si.product_name
      ORDER BY revenue DESC
      LIMIT 10
    `,
      [fromSQL, toSQL]
    )

    const round = (value: unknown) => Math.round(Number(value || 0) * 100) / 100
    const commerceTotal = round(cRow.total)
    const commerceCost = round(ciRow.cost)

    const commerce = {
      total: commerceTotal,
      efectivo: round(cRow.efectivo),
      transferencia: round(cRow.transferencia),
      postnet: round(cRow.postnet),
      salesCount: Number(cRow.sales_count || 0),
      unitsSold: Number(ciRow.units || 0),
      cost: commerceCost,
      margin: round(commerceTotal - commerceCost),
      topProducts: ((topProductsRes[0] as any[]) || []).map((row) => ({
        productId: row.product_id,
        name: row.product_name,
        units: Number(row.units || 0),
        revenue: round(row.revenue),
      })),
    }

    // What actually went through the register: courts + shop.
    const cajaGeneral = round(cajaTotal + commerceTotal)

    // ── Gastos de las instalaciones ────────────────────────────────────────
    // Bloque propio, igual que `commerce` y por la misma razón: paymentBreakdown y
    // reconciliation cargan la invariante grandTotal = cajaTotal = facturado +
    // senasSinSaldar, que habla SOLO de plata de canchas. Meter gastos ahí haría que la
    // reconciliación dejara de reconciliar. El neto se expone explícito como
    // `resultadoNeto` en vez de contrabandearse dentro de los números de cancha.
    //
    // Gateado en `expenses.view`: el gasto tiene su propio permiso, así que quien no lo
    // tiene no recibe ni el bloque ni el neto. Mandar el neto sin el detalle sería peor
    // que no mandar nada — un número que no se puede explicar con lo que está en pantalla.
    //
    // Se filtra por `expense_date`, NO por `created_at`: la factura de la luz de ayer se
    // carga hoy y pertenece a ayer. Misma lógica que `occurrence_date` en las fijas.
    // Los anulados quedan afuera en todas partes: un gasto anulado no salió de la caja.
    const perms = await getRequestPermissions(ctx)
    const canSeeExpenses = can(perms, 'expenses', 'view')

    let expenses: {
      total: number
      efectivo: number
      transferencia: number
      postnet: number
      count: number
      byCategory: { categoryId: number | null; name: string; total: number; count: number }[]
    } | null = null
    let resultadoNeto: number | null = null

    if (canSeeExpenses) {
      const expensesExpr =
        paymentMethod === 'efectivo'
          ? 'e.efectivo'
          : paymentMethod === 'transferencia'
            ? 'e.transferencia'
            : paymentMethod === 'postnet'
              ? 'e.postnet'
              : 'e.amount'

      const expensesRes = await db.rawQuery(
        `
        SELECT
          COALESCE(SUM(${expensesExpr}), 0)  AS total,
          COALESCE(SUM(e.efectivo), 0)       AS efectivo,
          COALESCE(SUM(e.transferencia), 0)  AS transferencia,
          COALESCE(SUM(e.postnet), 0)        AS postnet,
          COUNT(e.id)                        AS expenses_count
        FROM expenses e
        WHERE e.status = 'completed'
          AND e.expense_date >= ? AND e.expense_date <= ?
      `,
        [fromDate, toDate]
      )
      const eRow = (expensesRes[0] as any[])[0] || {}

      // LEFT JOIN, no INNER: un gasto sin categoría (o cuya categoría se retiró) tiene que
      // seguir apareciendo, agrupado como "Sin categoría". Si se cayera, la suma de la
      // tabla no daría el total de arriba — el primer control que hace cualquiera.
      const byCategoryRes = await db.rawQuery(
        `
        SELECT
          e.category_id                       AS category_id,
          ec.name                             AS category_name,
          COALESCE(SUM(${expensesExpr}), 0)   AS total,
          COUNT(e.id)                         AS expenses_count
        FROM expenses e
        LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.status = 'completed'
          AND e.expense_date >= ? AND e.expense_date <= ?
        GROUP BY e.category_id, ec.name
        ORDER BY total DESC
      `,
        [fromDate, toDate]
      )

      expenses = {
        total: round(eRow.total),
        efectivo: round(eRow.efectivo),
        transferencia: round(eRow.transferencia),
        postnet: round(eRow.postnet),
        count: Number(eRow.expenses_count || 0),
        byCategory: ((byCategoryRes[0] as any[]) || []).map((row) => ({
          categoryId: row.category_id ?? null,
          name: row.category_name || 'Sin categoría',
          total: round(row.total),
          count: Number(row.expenses_count || 0),
        })),
      }

      // Lo que quedó: todo lo que entró por la caja, menos lo que salió.
      resultadoNeto = round(cajaGeneral - expenses.total)
    }

    return response.ok({
      period,
      from: from.toISO(),
      to: to.toISO(),
      courts: result,
      grandTotal,
      paymentBreakdown,
      reconciliation,
      commerce,
      cajaGeneral,
      ...(expenses ? { expenses, resultadoNeto } : {}),
    })
  }
}
