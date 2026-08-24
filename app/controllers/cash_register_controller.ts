import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import CashSession from '#models/cash_session'
import { can, getRequestPermissions } from '#services/permissions'
import { round2 } from '#services/commerce'
import {
  loadMovements,
  minuteLabel,
  newSessionFields,
  resolveCashState,
  serializeSession,
  serializeSessionOrNull,
  totalsFor,
} from '#services/cash_register'
import { shiftForCharge } from '#services/cash_shifts'

/**
 * La caja del complejo. Una sola, secuencial: se abre, se cierra, se abre la siguiente.
 *
 * El invariante "nunca hay más de una sesión abierta" lo garantiza el índice UNIQUE
 * sobre `open_marker` (ver la migración 1784000000003), no los chequeos de acá. Los
 * chequeos existen para devolver un 409 con un mensaje útil en lugar de un error de
 * base de datos; si dos requests llegan a la vez, el que pierde igual choca contra el
 * índice y se traduce al mismo 409.
 */
export default class CashRegisterController {
  /** GET /cash-register/current — el turno abierto, sus movimientos y sus totales. */
  async current(ctx: HttpContext) {
    const { response } = ctx
    const perms = await getRequestPermissions(ctx)
    const canSeeExpenseDetail = can(perms, 'expenses', 'view')

    const state = await resolveCashState()

    const movements = state.session
      ? await loadMovements(state.session.id, { canSeeExpenseDetail })
      : []
    const totals = totalsFor(movements, state.session?.openingEfectivo ?? 0)

    const lastSession = state.session
      ? null
      : await CashSession.query()
          .whereNotNull('closed_at')
          .preload('closer', (q) => q.select('id', 'fullName'))
          .orderBy('closed_at', 'desc')
          .first()

    return response.ok({
      reason: state.reason,
      session: serializeSessionOrNull(state.session),
      movements,
      totals,
      shifts: state.shifts,
      shiftInCourse: state.shiftInCourse
        ? { ...state.shiftInCourse, label: shiftLabelOf(state.shiftInCourse.shift) }
        : null,
      // En qué turno caería un cobro hecho ahora. Con la caja cerrada es lo que hay que
      // ofrecer abrir; a las 02:00 eso es el turno de la tarde del día anterior.
      suggestedShift: {
        ...state.chargeShift,
        label: shiftLabelOf(state.chargeShift.shift),
      },
      needsRotation: state.reason === 'shift_changed',
      lastSession: serializeSessionOrNull(lastSession),
      canOpen: can(perms, 'cash_register', 'create'),
      canClose: can(perms, 'cash_register', 'update'),
    })
  }

  /** POST /cash-register/open — abre la caja del turno que corresponde. */
  async open({ request, response, auth }: HttpContext) {
    const user = auth.user!
    const openingEfectivo = Math.max(0, Number(request.input('openingEfectivo', 0)) || 0)

    const existing = await CashSession.query().whereNull('closed_at').first()
    if (existing) {
      return response.conflict({
        code: 'CASH_REGISTER_ALREADY_OPEN',
        message: `La caja ya está abierta (turno ${existing.shiftName}).`,
        session: serializeSession(existing),
      })
    }

    // El turno NO lo elige el cliente: sale del reloj. Si lo mandara el front, dos
    // pantallas desincronizadas podrían abrir la caja en un turno que no corre.
    const state = await resolveCashState()
    const placement = state.chargeShift

    try {
      const session = await CashSession.create(
        newSessionFields(placement, user.id, openingEfectivo)
      )
      await session.load('opener', (q) => q.select('id', 'fullName'))
      return response.created({ session: serializeSession(session) })
    } catch (error) {
      // El UNIQUE sobre open_marker: alguien más abrió entre el chequeo y el insert.
      if (isDuplicateOpenSession(error)) {
        const winner = await CashSession.query().whereNull('closed_at').first()
        return response.conflict({
          code: 'CASH_REGISTER_ALREADY_OPEN',
          message: 'Otra persona acaba de abrir la caja.',
          session: serializeSessionOrNull(winner),
        })
      }
      throw error
    }
  }

  /** POST /cash-register/close — congela los totales y cierra el turno. */
  async close(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const perms = await getRequestPermissions(ctx)
    const canSeeExpenseDetail = can(perms, 'expenses', 'view')
    const user = auth.user!

    const sessionId = Number(request.input('sessionId')) || 0
    const countedEfectivo = parseCounted(request.input('countedEfectivo'))
    const notes = parseNotes(request.input('notes'))

    const closed = await this.closeOpenSession(sessionId, {
      closedBy: user.id,
      countedEfectivo,
      notes,
      canSeeExpenseDetail,
    })
    if ('error' in closed) return response.conflict(closed.error)

    return response.ok({ session: serializeSession(closed.session) })
  }

  /**
   * POST /cash-register/rotate — cierra el turno vencido y abre el que corre, en UNA
   * transacción.
   *
   * Atómico a propósito: si fallara entre el cierre y la apertura, la caja quedaría
   * cerrada en medio del servicio y el próximo cobro se bloquearía sin que nadie
   * entienda por qué.
   */
  async rotate(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const perms = await getRequestPermissions(ctx)
    const canSeeExpenseDetail = can(perms, 'expenses', 'view')
    const user = auth.user!

    const sessionId = Number(request.input('sessionId')) || 0
    const countedEfectivo = parseCounted(request.input('countedEfectivo'))
    const notes = parseNotes(request.input('notes'))
    const openingEfectivo = Math.max(0, Number(request.input('openingEfectivo', 0)) || 0)

    const trx = await db.transaction()
    try {
      const open = await CashSession.query({ client: trx })
        .whereNull('closed_at')
        .forUpdate()
        .first()

      if (!open) {
        await trx.rollback()
        return response.conflict({
          code: 'CASH_REGISTER_CLOSED',
          message: 'La caja no está abierta, no hay nada que rotar.',
        })
      }
      if (sessionId && open.id !== sessionId) {
        await trx.rollback()
        return response.conflict({
          code: 'CASH_SESSION_STALE',
          message: 'La caja cambió desde que abriste la pantalla. Refrescá y volvé a intentar.',
          session: serializeSession(open),
        })
      }

      // El `now` es UNO solo para el cierre y la apertura: la rotación es un instante,
      // no dos.
      const now = DateTime.now()
      const movements = await loadMovements(open.id, { canSeeExpenseDetail })
      const totals = totalsFor(movements, open.openingEfectivo)

      open.useTransaction(trx)
      applyClose(open, totals, now, user.id, countedEfectivo, notes)
      await open.save()

      const nextState = await resolveCashState(now)
      const placement = shiftForCharge(now, nextState.shifts)
      const next = new CashSession()
      next.useTransaction(trx)
      next.merge(newSessionFields(placement, user.id, openingEfectivo, now))
      await next.save()

      await trx.commit()

      return response.ok({
        closed: serializeSession(open),
        session: serializeSession(next),
      })
    } catch (error) {
      await trx.rollback()
      if (isDuplicateOpenSession(error)) {
        return response.conflict({
          code: 'CASH_REGISTER_ALREADY_OPEN',
          message: 'Otra persona acaba de rotar la caja.',
        })
      }
      throw error
    }
  }

  /** GET /cash-register/sessions — historial de cierres. */
  async index({ request, response }: HttpContext) {
    const page = Math.max(1, Number(request.input('page', 1)) || 1)
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20)) || 20))

    const sessions = await CashSession.query()
      .whereNotNull('closed_at')
      .preload('opener', (q) => q.select('id', 'fullName'))
      .preload('closer', (q) => q.select('id', 'fullName'))
      .orderBy('closed_at', 'desc')
      .paginate(page, perPage)

    const json = sessions.toJSON()
    return response.ok({
      ...json,
      data: sessions.all().map((s) => serializeSession(s)),
    })
  }

  /**
   * GET /cash-register/sessions/:id — el cierre y TODOS sus movimientos con su método
   * de pago.
   *
   * Los movimientos se recalculan sobre la ventana de la sesión en lugar de guardarse:
   * el invariante de sesión única y sin huecos hace que la ventana sea inequívoca, así
   * que duplicar las filas solo abriría la puerta a que las dos versiones difieran.
   */
  async show(ctx: HttpContext) {
    const { params, response } = ctx
    const perms = await getRequestPermissions(ctx)
    const canSeeExpenseDetail = can(perms, 'expenses', 'view')

    const session = await CashSession.query()
      .where('id', params.id)
      .preload('opener', (q) => q.select('id', 'fullName'))
      .preload('closer', (q) => q.select('id', 'fullName'))
      .firstOrFail()

    const movements = await loadMovements(session.id, { canSeeExpenseDetail })

    return response.ok({
      session: serializeSession(session),
      movements,
      totals: totalsFor(movements, session.openingEfectivo),
    })
  }

  // ─── interno ──────────────────────────────────────────────────────────────

  private async closeOpenSession(
    sessionId: number,
    opts: {
      closedBy: number
      countedEfectivo: number | null
      notes: string | null
      canSeeExpenseDetail: boolean
    }
  ): Promise<{ session: CashSession } | { error: Record<string, unknown> }> {
    const trx = await db.transaction()
    try {
      const session = await CashSession.query({ client: trx })
        .whereNull('closed_at')
        .forUpdate()
        .first()

      if (!session) {
        await trx.rollback()
        return {
          error: { code: 'CASH_REGISTER_CLOSED', message: 'La caja ya está cerrada.' },
        }
      }
      if (sessionId && session.id !== sessionId) {
        await trx.rollback()
        return {
          error: {
            code: 'CASH_SESSION_STALE',
            message: 'Otra persona ya cerró la caja. Refrescá la pantalla.',
            session: serializeSession(session),
          },
        }
      }

      // Los totales se RECALCULAN acá, nunca se toman del cliente: el arqueo es la
      // única cifra del sistema que no puede depender de lo que mandó una pantalla.
      //
      // Como los movimientos se filtran por `cash_session_id`, lo que se congela acá y
      // lo que el historial vuelve a derivar después son la misma cifra por
      // construcción. Con la derivación por ventana de tiempo eso no estaba garantizado.
      const closedAt = DateTime.now()
      const movements = await loadMovements(session.id, {
        canSeeExpenseDetail: opts.canSeeExpenseDetail,
      })
      const totals = totalsFor(movements, session.openingEfectivo)

      session.useTransaction(trx)
      applyClose(session, totals, closedAt, opts.closedBy, opts.countedEfectivo, opts.notes)
      await session.save()
      await trx.commit()

      await session.load('opener', (q) => q.select('id', 'fullName'))
      await session.load('closer', (q) => q.select('id', 'fullName'))
      return { session }
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }
}

function shiftLabelOf(shift: { name: string; startMinute: number; endMinute: number }): string {
  return `${shift.name} (${minuteLabel(shift.startMinute)}–${minuteLabel(shift.endMinute)})`
}

function applyClose(
  session: CashSession,
  totals: ReturnType<typeof totalsFor>,
  at: DateTime,
  closedBy: number,
  countedEfectivo: number | null,
  notes: string | null
) {
  session.inEfectivo = totals.in.efectivo
  session.inTransferencia = totals.in.transferencia
  session.inPostnet = totals.in.postnet
  session.outEfectivo = totals.out.efectivo
  session.outTransferencia = totals.out.transferencia
  session.outPostnet = totals.out.postnet
  session.movementsCount = totals.count
  session.countedEfectivo = countedEfectivo
  session.notes = notes
  session.closedAt = at
  session.closedBy = closedBy
  // NULL, no 0: es lo que libera el índice UNIQUE para la próxima sesión.
  session.openMarker = null
}

function parseCounted(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return null
  return round2(value)
}

function parseNotes(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed ? trimmed.slice(0, 500) : null
}

function isDuplicateOpenSession(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT'
}
