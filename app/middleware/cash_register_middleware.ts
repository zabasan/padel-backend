import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import {
  minuteLabel,
  primeRequestCashSession,
  resolveCashState,
  serializeSession,
} from '#services/cash_register'

/**
 * No se registra plata sin caja abierta.
 *
 * Va declarativo en las rutas y no dentro de cada controller a propósito: los OCHO
 * endpoints que mueven el cajón viven en tres controllers distintos, y el día que
 * alguien agregue un noveno la guarda tiene que ser algo que se vea en routes.ts, no
 * una línea que hay que acordarse de copiar.
 *
 * EL DISPARADOR DE LA ROTACIÓN ES LA COMPARACIÓN DE TURNOS, NO `now > expected_close_at`.
 *
 * Esa distinción es toda la lógica de este archivo. A las 02:00, con turnos 08–16 y
 * 16–24, el turno de la tarde está vencido hace dos horas — pero NO hay ningún turno
 * corriendo, así que no hay nada que rotar y el cobro entra en la sesión abierta. Si el
 * disparador fuera el vencimiento, la app pediría cerrar y abrir la caja a las 2 de la
 * mañana, y otra vez a las 3, y a las 4, en medio del servicio.
 *
 * Se pide rotar solo cuando el reloj dice que corre OTRO turno que el que está abierto.
 */
export default class CashRegisterMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const state = await resolveCashState()

    if (state.reason === 'closed') {
      return ctx.response.conflict({
        code: 'CASH_REGISTER_CLOSED',
        message: `La caja está cerrada. Para registrar el movimiento hay que abrir el turno ${labelOf(state.chargeShift.shift)}.`,
        suggestedShift: {
          ...state.chargeShift,
          label: labelOf(state.chargeShift.shift),
        },
      })
    }

    if (state.reason === 'shift_changed') {
      const open = state.session!
      return ctx.response.conflict({
        code: 'CASH_SHIFT_CHANGED',
        message: `Está abierto el turno ${open.shiftName} (${minuteLabel(open.shiftStartMinute)}–${minuteLabel(open.shiftEndMinute)}) pero ahora corre ${labelOf(state.shiftInCourse!.shift)}. Hay que cerrar el turno abierto y abrir el que corre.`,
        session: serializeSession(open),
        nextShift: {
          ...state.shiftInCourse!,
          label: labelOf(state.shiftInCourse!.shift),
        },
      })
    }

    // El controller va a necesitar esta misma sesión para estamparla en la fila del
    // movimiento. Se siembra el caché del request en lugar de volver a consultarla.
    primeRequestCashSession(ctx, state.session)
    return next()
  }
}

function labelOf(shift: { name: string; startMinute: number; endMinute: number }): string {
  return `${shift.name} (${minuteLabel(shift.startMinute)}–${minuteLabel(shift.endMinute)})`
}
