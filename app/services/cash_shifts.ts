import { DateTime } from 'luxon'
import Setting from '#models/setting'

const ART_TZ = 'America/Argentina/Buenos_Aires'

export const CASH_SHIFTS_KEY = 'cashShifts'

/**
 * Un turno de caja: un nombre y una ventana horaria dentro del día ART, en MINUTOS
 * desde medianoche.
 *
 * Minutos y no horas enteras porque un turno que arranca 8:30 no debería necesitar
 * una migración. `endMinute: 1440` es la medianoche del día siguiente, que es
 * exactamente cómo se expresa el turno "de 16 a 24" sin ningún caso especial.
 *
 * Un turno NO puede cruzar la medianoche (el tope es 1440). Eso mantiene la
 * resolución trivial: `businessDate` de un instante es siempre su propio día ART, y
 * la ventana de un turno nunca se parte en dos rangos. Si algún día hace falta un
 * turno 22:00–02:00, es un cambio consciente acá y en shiftForCharge, no un efecto
 * colateral.
 */
export interface CashShift {
  name: string
  startMinute: number
  endMinute: number
}

/** Un turno situado en un día concreto. */
export interface ShiftPlacement {
  shift: CashShift
  /** 'yyyy-MM-dd' en ART. */
  businessDate: string
}

export const MINUTES_IN_DAY = 1440
export const MAX_SHIFTS = 6

export const DEFAULT_SHIFTS: CashShift[] = [
  { name: 'Mañana', startMinute: 8 * 60, endMinute: 16 * 60 },
  { name: 'Tarde', startMinute: 16 * 60, endMinute: MINUTES_IN_DAY },
]

export type ShiftValidation = { ok: true; shifts: CashShift[] } | { ok: false; error: string }

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/**
 * Valida y normaliza una lista de turnos. Los devuelve ORDENADOS por `startMinute`,
 * así que el resto del servicio puede asumir orden sin volver a ordenar.
 *
 * Los HUECOS se permiten a propósito: el complejo está cerrado de 00:00 a 08:00 y eso
 * es un hueco legítimo, no un error de configuración. Los SOLAPAMIENTOS no, porque
 * dos turnos corriendo a la vez volvería ambigua la pregunta "¿qué turno corre ahora?",
 * que es la que decide si hay que rotar la caja.
 */
export function validateShifts(input: unknown): ShiftValidation {
  if (!Array.isArray(input)) return { ok: false, error: 'Los turnos deben ser una lista' }
  if (input.length === 0) return { ok: false, error: 'Tiene que haber al menos un turno' }
  if (input.length > MAX_SHIFTS) {
    return { ok: false, error: `No puede haber más de ${MAX_SHIFTS} turnos` }
  }

  const shifts: CashShift[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Turno inválido' }
    const candidate = raw as Record<string, unknown>

    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!name) return { ok: false, error: 'Cada turno necesita un nombre' }
    if (name.length > 40) return { ok: false, error: 'El nombre del turno es demasiado largo' }

    const startMinute = candidate.startMinute
    const endMinute = candidate.endMinute
    if (!isInt(startMinute) || !isInt(endMinute)) {
      return { ok: false, error: `El horario del turno "${name}" es inválido` }
    }
    if (startMinute < 0 || startMinute >= MINUTES_IN_DAY) {
      return { ok: false, error: `El inicio del turno "${name}" está fuera del día` }
    }
    if (endMinute <= 0 || endMinute > MINUTES_IN_DAY) {
      return { ok: false, error: `El fin del turno "${name}" está fuera del día` }
    }
    if (startMinute >= endMinute) {
      return { ok: false, error: `El turno "${name}" termina antes de empezar` }
    }

    shifts.push({ name, startMinute, endMinute })
  }

  shifts.sort((a, b) => a.startMinute - b.startMinute)

  for (let i = 1; i < shifts.length; i++) {
    if (shifts[i].startMinute < shifts[i - 1].endMinute) {
      return {
        ok: false,
        error: `Los turnos "${shifts[i - 1].name}" y "${shifts[i].name}" se solapan`,
      }
    }
  }

  const names = new Set<string>()
  for (const shift of shifts) {
    if (names.has(shift.name)) {
      return { ok: false, error: `Hay dos turnos llamados "${shift.name}"` }
    }
    names.add(shift.name)
  }

  return { ok: true, shifts }
}

/**
 * Lee el JSON guardado en settings. Un valor ausente, corrupto o inválido cae al
 * default en lugar de tirar: un setting roto no puede dejar la caja sin poder abrirse,
 * que sería la app entera bloqueada por un string mal escrito.
 */
export function parseShifts(raw: string | null | undefined): CashShift[] {
  if (!raw) return DEFAULT_SHIFTS
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return DEFAULT_SHIFTS
  }
  const result = validateShifts(decoded)
  return result.ok ? result.shifts : DEFAULT_SHIFTS
}

export function serializeShifts(shifts: CashShift[]): string {
  return JSON.stringify(shifts)
}

/** Los turnos configurados, o el default si nunca se guardaron. */
export async function loadShifts(): Promise<CashShift[]> {
  const row = await Setting.find(CASH_SHIFTS_KEY)
  return parseShifts(row?.value ?? null)
}

/** Minuto del día (0–1439) de un instante, en ART. */
export function minuteOfDayART(at: DateTime): number {
  const art = at.setZone(ART_TZ)
  return art.hour * 60 + art.minute
}

/** La ventana real de un turno en un día concreto. `endMinute: 1440` cae en la medianoche siguiente. */
export function shiftWindowFor(
  shift: CashShift,
  businessDate: string
): { startsAt: DateTime; endsAt: DateTime } {
  const dayStart = DateTime.fromISO(businessDate, { zone: ART_TZ }).startOf('day')
  return {
    startsAt: dayStart.plus({ minutes: shift.startMinute }),
    endsAt: dayStart.plus({ minutes: shift.endMinute }),
  }
}

/**
 * El turno que CONTIENE el instante, o `null` si no hay ninguno corriendo.
 *
 * `null` es un resultado válido y significativo, no un error: a las 02:00 con turnos
 * 08–16 y 16–24 no hay ningún turno en curso, y eso es justo lo que hace que NO haya
 * que rotar la caja a esa hora. Ver shiftForCharge para la otra pregunta.
 *
 * Intervalos semiabiertos [start, end): a las 16:00 en punto con turnos 08–16 y 16–24
 * el turno en curso es Tarde, sin ambigüedad.
 */
export function shiftInCourseAt(at: DateTime, shifts: CashShift[]): ShiftPlacement | null {
  const art = at.setZone(ART_TZ)
  const minute = minuteOfDayART(art)
  const shift = shifts.find((s) => minute >= s.startMinute && minute < s.endMinute)
  if (!shift) return null
  return { shift, businessDate: art.toISODate()! }
}

/**
 * En qué turno hay que imputar un movimiento hecho en este instante. Nunca devuelve
 * `null`: la plata siempre entra en algún lado.
 *
 * El turno en curso si hay uno; si no, el ÚLTIMO turno que terminó. A las 02:00 del 25
 * con turnos 08–16 y 16–24 eso da `Tarde / 24`, no `Mañana / 25`: la madrugada
 * pertenece al turno de la tarde que se estiró, que es como funciona el mostrador.
 *
 * Es una función APARTE de shiftInCourseAt porque responde otra pregunta. Esta decide
 * en qué sesión va el cobro (y qué sesión abrir si no hay ninguna); la otra decide si
 * el reloj cambió de turno. Confundirlas hace que la app pida cerrar y abrir la caja a
 * las 2 de la mañana, y otra vez a las 3.
 */
export function shiftForCharge(at: DateTime, shifts: CashShift[]): ShiftPlacement {
  const inCourse = shiftInCourseAt(at, shifts)
  if (inCourse) return inCourse

  const art = at.setZone(ART_TZ)
  const minute = minuteOfDayART(art)

  // Turnos que ya terminaron HOY: el último de ellos.
  const endedToday = shifts.filter((s) => s.endMinute <= minute)
  if (endedToday.length > 0) {
    const shift = endedToday.reduce((a, b) => (b.endMinute > a.endMinute ? b : a))
    return { shift, businessDate: art.toISODate()! }
  }

  // Ninguno terminó hoy todavía (es de madrugada, antes del primer turno): el último
  // turno de AYER.
  const last = shifts.reduce((a, b) => (b.endMinute > a.endMinute ? b : a))
  return { shift: last, businessDate: art.minus({ days: 1 }).toISODate()! }
}

/** Dos ubicaciones de turno son la misma sesión si coinciden nombre Y día. */
export function samePlacement(
  a: { shiftName: string; businessDate: string },
  b: { shiftName: string; businessDate: string }
): boolean {
  return a.shiftName === b.shiftName && a.businessDate === b.businessDate
}
