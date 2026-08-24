import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import CashSession from '#models/cash_session'
import Expense from '#models/expense'
import ReservationPayment from '#models/reservation_payment'
import Sale from '#models/sale'
import { round2 } from '#services/commerce'
import {
  loadShifts,
  samePlacement,
  shiftForCharge,
  shiftInCourseAt,
  shiftWindowFor,
  type CashShift,
  type ShiftPlacement,
} from '#services/cash_shifts'

/**
 * Los seis hechos que mueven el cajón. Tres entran, tres salen.
 *
 * La regla de atribución es una sola y vale para todos: un movimiento pertenece al
 * turno en que OCURRIÓ EL HECHO — created_at, reverted_at o cancelled_at — nunca a la
 * fecha de negocio del comprobante. Un gasto de la luz de ayer cargado hoy sale del
 * cajón HOY, así que va en el turno de hoy aunque su `expense_date` diga ayer. Lo
 * mismo con `occurrence_date` de una fija: la plata entró cuando se cobró.
 *
 * Un cobro hecho y revertido dentro del mismo turno aparece dos veces, +X y −X, y
 * netea cero. Es correcto y además honesto: el turno muestra que pasó.
 */
export type MovementKind =
  | 'court_payment'
  | 'sale'
  | 'expense_cancelled'
  | 'expense'
  | 'payment_reverted'
  | 'sale_cancelled'

export interface CashMovement {
  at: string
  kind: MovementKind
  direction: 'in' | 'out'
  actorId: number | null
  actorName: string | null
  label: string
  reference: string | null
  efectivo: number
  transferencia: number
  postnet: number
  total: number
}

export interface MethodTotals {
  efectivo: number
  transferencia: number
  postnet: number
  total: number
}

export interface CashTotals {
  in: MethodTotals
  out: MethodTotals
  net: MethodTotals
  /** Lo que TIENE que haber en el cajón: fondo + entradas − salidas, solo efectivo. */
  expectedEfectivo: number
  count: number
}

const EMPTY: MethodTotals = { efectivo: 0, transferencia: 0, postnet: 0, total: 0 }

const REQUEST_CASH_SESSION_CACHE = Symbol.for('padel.cashSession.requestCache')

/**
 * La sesión de caja abierta, cacheada en el request.
 *
 * Cachea la PROMESA y no el valor, igual que getRequestPermissions: el middleware la
 * resuelve para decidir si deja pasar el movimiento y el controller la necesita después
 * para estamparla en la fila, y así comparten una sola consulta.
 */
export function getRequestCashSession(ctx: HttpContext): Promise<CashSession | null> {
  const cache = ctx as unknown as Record<symbol, Promise<CashSession | null> | undefined>
  if (!cache[REQUEST_CASH_SESSION_CACHE]) {
    cache[REQUEST_CASH_SESSION_CACHE] = openSessionOrNull()
  }
  return cache[REQUEST_CASH_SESSION_CACHE]!
}

/** Siembra el caché con la sesión que el middleware ya resolvió, para no consultarla dos veces. */
export function primeRequestCashSession(ctx: HttpContext, session: CashSession | null): void {
  const cache = ctx as unknown as Record<symbol, Promise<CashSession | null> | undefined>
  cache[REQUEST_CASH_SESSION_CACHE] = Promise.resolve(session)
}

/** El id de la sesión abierta, o null. Lo que los controllers estampan en la fila. */
export async function currentCashSessionId(ctx: HttpContext): Promise<number | null> {
  const session = await getRequestCashSession(ctx)
  return session?.id ?? null
}

function splitOf(row: {
  efectivo: number | string
  transferencia: number | string
  postnet: number | string
  total: number | string
}) {
  return {
    efectivo: round2(Number(row.efectivo ?? 0)),
    transferencia: round2(Number(row.transferencia ?? 0)),
    postnet: round2(Number(row.postnet ?? 0)),
    total: round2(Number(row.total ?? 0)),
  }
}

export interface LoadMovementsOptions {
  /**
   * Sin `expenses.view`, el gasto SIGUE apareciendo con su monto pero sin descripción,
   * proveedor ni categoría. Esconderlo entero le rompería el arqueo a quien cierra la
   * caja: la plata salió del cajón y el conteo tiene que dar. Mostrarle el detalle le
   * daría acceso a información que su permiso le niega. El monto sin el detalle es la
   * única respuesta que cumple las dos cosas.
   */
  canSeeExpenseDetail: boolean
}

/**
 * Los movimientos de una sesión de caja.
 *
 * Filtra por `cash_session_id` / `reverted_in_cash_session_id` /
 * `cancelled_in_cash_session_id` — la atribución es un dato estampado en la fila cuando
 * el movimiento ocurrió, no un cálculo sobre timestamps. Ver la migración
 * 1784000000005 para por qué la derivación por ventana de tiempo no servía.
 *
 * Consecuencia práctica: el arqueo que se congela al cerrar y el que el historial vuelve
 * a derivar después son la misma cifra por construcción, no por coincidencia.
 */
export async function loadMovements(
  sessionId: number,
  opts: LoadMovementsOptions
): Promise<CashMovement[]> {
  const movements: CashMovement[] = []

  // ── 1 y 2. Cobros de cancha y sus devoluciones ─────────────────────────────
  const paymentsIn = await ReservationPayment.query()
    .where('cash_session_id', sessionId)
    .preload('payer', (q) => q.select('id', 'fullName'))
    .preload('reservation', (q) => q.preload('court').preload('customer'))
    .orderBy('created_at', 'desc')

  for (const p of paymentsIn) {
    const courtName = p.reservation?.court?.name ?? 'Cancha'
    const who = p.reservation?.customer?.fullName
    const typeWord = p.type === 'deposit' ? 'seña' : 'turno'
    movements.push({
      at: p.createdAt.toISO()!,
      kind: 'court_payment',
      direction: 'in',
      actorId: p.paidBy,
      actorName: p.payer?.fullName ?? null,
      label: `${courtName} · ${typeWord}${who ? ` · ${who}` : ''}`,
      reference: `#${p.reservationId}`,
      ...splitOf(p),
    })
  }

  // Un cobro de un turno ANTERIOR revertido en este sale del cajón AHORA. Es el caso
  // que justificó dejar de borrar los pagos: sin la fila no habría nada que restar.
  const paymentsReverted = await ReservationPayment.query()
    .where('reverted_in_cash_session_id', sessionId)
    .preload('reverter', (q) => q.select('id', 'fullName'))
    .preload('reservation', (q) => q.preload('court'))
    .orderBy('reverted_at', 'desc')

  for (const p of paymentsReverted) {
    const courtName = p.reservation?.court?.name ?? 'Cancha'
    movements.push({
      at: (p.revertedAt ?? p.createdAt).toISO()!,
      kind: 'payment_reverted',
      direction: 'out',
      actorId: p.revertedBy,
      actorName: p.reverter?.fullName ?? null,
      label: `Devolución · ${courtName}`,
      reference: `#${p.reservationId}`,
      ...splitOf(p),
    })
  }

  // ── 3 y 4. Ventas de kiosco y sus anulaciones ─────────────────────────────
  // Sin filtro de status: una venta hecha y anulada en el mismo turno tiene que
  // aparecer como +X y −X. Filtrar por status='completed' dejaría solo la salida y el
  // turno cerraría con un neto negativo por una venta que nunca movió plata.
  const sales = await Sale.query()
    .where('cash_session_id', sessionId)
    .preload('seller', (q) => q.select('id', 'fullName'))
    .orderBy('created_at', 'desc')

  for (const sale of sales) {
    movements.push({
      at: sale.createdAt.toISO()!,
      kind: 'sale',
      direction: 'in',
      actorId: sale.userId,
      actorName: sale.seller?.fullName ?? null,
      label: 'Kiosco',
      reference: `#${sale.id}`,
      ...splitOf(sale),
    })
  }

  const salesCancelled = await Sale.query()
    .where('cancelled_in_cash_session_id', sessionId)
    .preload('canceller', (q) => q.select('id', 'fullName'))
    .orderBy('cancelled_at', 'desc')

  for (const sale of salesCancelled) {
    movements.push({
      at: (sale.cancelledAt ?? sale.createdAt).toISO()!,
      kind: 'sale_cancelled',
      direction: 'out',
      actorId: sale.cancelledBy,
      actorName: sale.canceller?.fullName ?? null,
      label: 'Anulación de venta',
      reference: `#${sale.id}`,
      ...splitOf(sale),
    })
  }

  // ── 5 y 6. Gastos y sus anulaciones ───────────────────────────────────────
  // El gasto pertenece al turno en que la plata salió del cajón, NO al día que dice
  // `expense_date`: la factura de la luz de ayer cargada hoy sale del cajón hoy.
  const expenses = await Expense.query()
    .where('cash_session_id', sessionId)
    .preload('creator', (q) => q.select('id', 'fullName'))
    .preload('category')
    .orderBy('created_at', 'desc')

  for (const e of expenses) {
    movements.push({
      at: e.createdAt.toISO()!,
      kind: 'expense',
      direction: 'out',
      actorId: e.createdBy,
      actorName: e.creator?.fullName ?? null,
      label: opts.canSeeExpenseDetail
        ? `Gasto · ${e.description}${e.category?.name ? ` (${e.category.name})` : ''}`
        : 'Salida de caja',
      reference: opts.canSeeExpenseDetail ? `#${e.id}` : null,
      ...expenseSplit(e),
    })
  }

  const expensesCancelled = await Expense.query()
    .where('cancelled_in_cash_session_id', sessionId)
    .preload('canceller', (q) => q.select('id', 'fullName'))
    .orderBy('cancelled_at', 'desc')

  for (const e of expensesCancelled) {
    movements.push({
      at: (e.cancelledAt ?? e.createdAt).toISO()!,
      kind: 'expense_cancelled',
      direction: 'in',
      actorId: e.cancelledBy,
      actorName: e.canceller?.fullName ?? null,
      label: opts.canSeeExpenseDetail ? `Gasto anulado · ${e.description}` : 'Reingreso a caja',
      reference: opts.canSeeExpenseDetail ? `#${e.id}` : null,
      ...expenseSplit(e),
    })
  }

  movements.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return movements
}

// El gasto guarda su importe en `amount`, no en `total` como las otras dos tablas.
function expenseSplit(e: Expense) {
  return {
    efectivo: round2(Number(e.efectivo ?? 0)),
    transferencia: round2(Number(e.transferencia ?? 0)),
    postnet: round2(Number(e.postnet ?? 0)),
    total: round2(Number(e.amount ?? 0)),
  }
}

/** Pura: totaliza una lista de movimientos ya normalizada. */
export function totalsFor(movements: CashMovement[], openingEfectivo = 0): CashTotals {
  const acc = { in: { ...EMPTY }, out: { ...EMPTY } }

  for (const m of movements) {
    const bucket = acc[m.direction]
    bucket.efectivo = round2(bucket.efectivo + m.efectivo)
    bucket.transferencia = round2(bucket.transferencia + m.transferencia)
    bucket.postnet = round2(bucket.postnet + m.postnet)
    bucket.total = round2(bucket.total + m.total)
  }

  const net: MethodTotals = {
    efectivo: round2(acc.in.efectivo - acc.out.efectivo),
    transferencia: round2(acc.in.transferencia - acc.out.transferencia),
    postnet: round2(acc.in.postnet - acc.out.postnet),
    total: round2(acc.in.total - acc.out.total),
  }

  return {
    in: acc.in,
    out: acc.out,
    net,
    expectedEfectivo: round2(round2(openingEfectivo) + net.efectivo),
    count: movements.length,
  }
}

// ─── Estado de la caja ───────────────────────────────────────────────────────

export async function openSessionOrNull(): Promise<CashSession | null> {
  return CashSession.query().whereNull('closed_at').first()
}

/**
 * Por qué hay (o no) que rotar la caja.
 *
 * `ok` — se puede cobrar. Incluye el caso de madrugada: no hay ningún turno en curso,
 * así que la sesión abierta absorbe el movimiento.
 * `closed` — no hay caja abierta; hay que abrir la del turno que corresponde.
 * `shift_changed` — el reloj dice que corre OTRO turno que el abierto.
 *
 * El disparador es la comparación de turnos, NO `now > expected_close_at`. A las 02:00
 * el turno de 16 a 24 está vencido pero no hay otro corriendo: si el disparador fuera
 * el vencimiento, la app pediría cerrar y abrir a las 2 de la mañana, y otra vez a las
 * 3, y a las 4.
 */
export type CashStateReason = 'ok' | 'closed' | 'shift_changed'

export interface CashState {
  reason: CashStateReason
  session: CashSession | null
  shifts: CashShift[]
  /** El turno que corre AHORA, o null si no corre ninguno (madrugada). */
  shiftInCourse: ShiftPlacement | null
  /** En qué turno hay que imputar un movimiento hecho ahora. Nunca null. */
  chargeShift: ShiftPlacement
}

export async function resolveCashState(now = DateTime.now()): Promise<CashState> {
  const shifts = await loadShifts()
  const shiftInCourse = shiftInCourseAt(now, shifts)
  const chargeShift = shiftForCharge(now, shifts)
  const session = await openSessionOrNull()

  if (!session) {
    return { reason: 'closed', session: null, shifts, shiftInCourse, chargeShift }
  }

  // Sin turno en curso (madrugada): la sesión abierta absorbe el movimiento.
  if (!shiftInCourse) {
    return { reason: 'ok', session, shifts, shiftInCourse, chargeShift }
  }

  // La comparación va sobre (turno, fecha), no solo el nombre: si alguien se olvidó de
  // cerrar el Tarde del 24 y son las 17:00 del 25, el nombre coincide pero hay que
  // rotar igual — 24 horas de movimientos en una sola sesión no son un turno.
  const matches = samePlacement(
    { shiftName: session.shiftName, businessDate: session.businessDate },
    { shiftName: shiftInCourse.shift.name, businessDate: shiftInCourse.businessDate }
  )

  return {
    reason: matches ? 'ok' : 'shift_changed',
    session,
    shifts,
    shiftInCourse,
    chargeShift,
  }
}

/** Los campos de una sesión nueva a partir de un turno situado. */
export function newSessionFields(
  placement: ShiftPlacement,
  openedBy: number,
  openingEfectivo: number,
  now = DateTime.now()
) {
  const { endsAt } = shiftWindowFor(placement.shift, placement.businessDate)
  return {
    shiftName: placement.shift.name,
    shiftStartMinute: placement.shift.startMinute,
    shiftEndMinute: placement.shift.endMinute,
    businessDate: placement.businessDate,
    openedAt: now,
    openedBy,
    expectedCloseAt: endsAt,
    openingEfectivo: round2(openingEfectivo),
    openMarker: 1,
  }
}

/**
 * Serializa una sesión para la API, con el turno legible ya armado.
 *
 * Los cuatro campos opcionales se normalizan a `null` explícito: Lucid omite del JSON
 * las columnas que la instancia nunca asignó, así que una sesión recién creada salía
 * sin `closedAt` en lugar de con `closedAt: null`. El front pregunta por ese campo para
 * saber si la caja está abierta, y una clave ausente y una clave en null no son lo
 * mismo cuando alguien escribe `'closedAt' in session`.
 */
// Dos funciones y no una con `| null`: el tipo de retorno se propaga al cliente tipado de
// la API, así que un `| null` acá obliga a chequear nulos en endpoints donde la sesión
// SIEMPRE existe (open, close, rotate). Separarlas hace que el tipo diga la verdad en cada
// endpoint en lugar de la más pesimista de todas.
//
// El tipo es abierto (`Record<string, any>`) porque el cuerpo sale de `session.serialize()`:
// anotar solo las claves que se sobreescriben abajo dejaría al resto invisible.
export function serializeSession(session: CashSession): Record<string, any> {
  return {
    ...session.serialize(),
    closedAt: session.closedAt ? session.closedAt.toISO() : null,
    closedBy: session.closedBy ?? null,
    countedEfectivo: session.countedEfectivo ?? null,
    notes: session.notes ?? null,
    openMarker: session.openMarker ?? null,
    shiftLabel: `${session.shiftName} (${minuteLabel(session.shiftStartMinute)}–${minuteLabel(session.shiftEndMinute)})`,
  }
}

/** Para los endpoints donde la caja puede estar cerrada (`current`) o no haber cierres previos. */
export function serializeSessionOrNull(session: CashSession | null): Record<string, any> | null {
  return session ? serializeSession(session) : null
}

export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
