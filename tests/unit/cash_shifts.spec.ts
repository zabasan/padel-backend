import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  DEFAULT_SHIFTS,
  parseShifts,
  samePlacement,
  shiftForCharge,
  shiftInCourseAt,
  shiftWindowFor,
  validateShifts,
  type CashShift,
} from '#services/cash_shifts'

const ART_TZ = 'America/Argentina/Buenos_Aires'

/** Los turnos reales del complejo: 08–16 y 16–24. */
const SHIFTS: CashShift[] = [
  { name: 'Mañana', startMinute: 480, endMinute: 960 },
  { name: 'Tarde', startMinute: 960, endMinute: 1440 },
]

function art(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: ART_TZ })
}

test.group('validateShifts', () => {
  test('acepta los dos turnos del complejo', ({ assert }) => {
    const result = validateShifts(SHIFTS)
    assert.isTrue(result.ok)
  })

  test('devuelve los turnos ordenados por hora de inicio', ({ assert }) => {
    const result = validateShifts([SHIFTS[1], SHIFTS[0]])
    assert.isTrue(result.ok)
    if (!result.ok) return
    assert.deepEqual(
      result.shifts.map((s) => s.name),
      ['Mañana', 'Tarde']
    )
  })

  test('rechaza turnos solapados', ({ assert }) => {
    const result = validateShifts([
      { name: 'Mañana', startMinute: 480, endMinute: 1020 },
      { name: 'Tarde', startMinute: 960, endMinute: 1440 },
    ])
    assert.isFalse(result.ok)
    if (result.ok) return
    assert.match(result.error, /solapan/)
  })

  // El complejo está cerrado de 00:00 a 08:00: eso es un hueco legítimo, no un error.
  test('acepta huecos entre turnos', ({ assert }) => {
    const result = validateShifts([
      { name: 'Mañana', startMinute: 480, endMinute: 720 },
      { name: 'Tarde', startMinute: 960, endMinute: 1440 },
    ])
    assert.isTrue(result.ok)
  })

  test('rechaza un turno que termina antes de empezar', ({ assert }) => {
    const result = validateShifts([{ name: 'Raro', startMinute: 960, endMinute: 480 }])
    assert.isFalse(result.ok)
  })

  // El tope es 1440 = medianoche. Un turno no cruza el día; ver el docblock del servicio.
  test('rechaza un turno que cruza la medianoche', ({ assert }) => {
    const result = validateShifts([{ name: 'Noche', startMinute: 1320, endMinute: 1560 }])
    assert.isFalse(result.ok)
  })

  test('acepta 1440 como fin (el turno de 16 a 24)', ({ assert }) => {
    const result = validateShifts([{ name: 'Tarde', startMinute: 960, endMinute: 1440 }])
    assert.isTrue(result.ok)
  })

  test('rechaza una lista vacía', ({ assert }) => {
    assert.isFalse(validateShifts([]).ok)
  })

  test('rechaza turnos sin nombre', ({ assert }) => {
    assert.isFalse(validateShifts([{ name: '   ', startMinute: 480, endMinute: 960 }]).ok)
  })

  test('rechaza dos turnos con el mismo nombre', ({ assert }) => {
    const result = validateShifts([
      { name: 'Turno', startMinute: 480, endMinute: 960 },
      { name: 'Turno', startMinute: 960, endMinute: 1440 },
    ])
    assert.isFalse(result.ok)
  })

  test('rechaza minutos no enteros', ({ assert }) => {
    assert.isFalse(validateShifts([{ name: 'X', startMinute: 480.5, endMinute: 960 }]).ok)
  })
})

test.group('parseShifts', () => {
  // Un setting roto no puede dejar la caja sin poder abrirse.
  test('un JSON corrupto cae al default en lugar de tirar', ({ assert }) => {
    assert.deepEqual(parseShifts('{no es json'), DEFAULT_SHIFTS)
  })

  test('un JSON válido pero con turnos inválidos cae al default', ({ assert }) => {
    assert.deepEqual(parseShifts('[{"name":"X","startMinute":-5,"endMinute":100}]'), DEFAULT_SHIFTS)
  })

  test('una clave ausente cae al default', ({ assert }) => {
    assert.deepEqual(parseShifts(null), DEFAULT_SHIFTS)
    assert.deepEqual(parseShifts(''), DEFAULT_SHIFTS)
  })

  test('parsea turnos guardados', ({ assert }) => {
    const shifts = parseShifts(JSON.stringify(SHIFTS))
    assert.lengthOf(shifts, 2)
    assert.equal(shifts[1].endMinute, 1440)
  })
})

test.group('shiftInCourseAt', () => {
  test('a las 10:00 corre Mañana', ({ assert }) => {
    const placement = shiftInCourseAt(art('2026-08-24T10:00'), SHIFTS)
    assert.equal(placement?.shift.name, 'Mañana')
    assert.equal(placement?.businessDate, '2026-08-24')
  })

  // Intervalos semiabiertos: a las 16:00 en punto ya corre Tarde, no Mañana.
  test('a las 16:00 en punto corre Tarde, no Mañana', ({ assert }) => {
    const placement = shiftInCourseAt(art('2026-08-24T16:00'), SHIFTS)
    assert.equal(placement?.shift.name, 'Tarde')
  })

  test('a las 23:59 corre Tarde', ({ assert }) => {
    assert.equal(shiftInCourseAt(art('2026-08-24T23:59'), SHIFTS)?.shift.name, 'Tarde')
  })

  // ESTE es el caso que define el disparador de la rotación: de madrugada NO hay turno
  // corriendo, así que no hay nada que rotar y el cobro entra en la sesión abierta.
  test('a las 02:00 NO hay ningún turno en curso', ({ assert }) => {
    assert.isNull(shiftInCourseAt(art('2026-08-25T02:00'), SHIFTS))
  })

  test('a las 07:00, antes del primer turno, no hay ninguno en curso', ({ assert }) => {
    assert.isNull(shiftInCourseAt(art('2026-08-25T07:00'), SHIFTS))
  })
})

test.group('shiftForCharge', () => {
  test('dentro de un turno devuelve ese turno', ({ assert }) => {
    const placement = shiftForCharge(art('2026-08-24T17:30'), SHIFTS)
    assert.equal(placement.shift.name, 'Tarde')
    assert.equal(placement.businessDate, '2026-08-24')
  })

  // La madrugada pertenece al turno de la tarde que se estiró — NO al Mañana que
  // todavía no arrancó. Si esto cambia, un cobro a las 2am abre un turno equivocado.
  test('a las 02:00 del 25 imputa a Tarde del 24', ({ assert }) => {
    const placement = shiftForCharge(art('2026-08-25T02:00'), SHIFTS)
    assert.equal(placement.shift.name, 'Tarde')
    assert.equal(placement.businessDate, '2026-08-24')
  })

  test('a las 07:00, antes del primer turno, sigue imputando a Tarde del día anterior', ({
    assert,
  }) => {
    const placement = shiftForCharge(art('2026-08-25T07:00'), SHIFTS)
    assert.equal(placement.shift.name, 'Tarde')
    assert.equal(placement.businessDate, '2026-08-24')
  })

  test('en un hueco del mediodía imputa al turno que acaba de terminar, del mismo día', ({
    assert,
  }) => {
    const withGap: CashShift[] = [
      { name: 'Mañana', startMinute: 480, endMinute: 720 },
      { name: 'Tarde', startMinute: 960, endMinute: 1440 },
    ]
    const placement = shiftForCharge(art('2026-08-24T13:00'), withGap)
    assert.equal(placement.shift.name, 'Mañana')
    assert.equal(placement.businessDate, '2026-08-24')
  })
})

test.group('shiftWindowFor', () => {
  test('endMinute 1440 cae en la medianoche del día siguiente', ({ assert }) => {
    const { startsAt, endsAt } = shiftWindowFor(SHIFTS[1], '2026-08-24')
    assert.equal(startsAt.toISO({ suppressMilliseconds: true }), '2026-08-24T16:00:00-03:00')
    assert.equal(endsAt.toISO({ suppressMilliseconds: true }), '2026-08-25T00:00:00-03:00')
  })

  test('la ventana de Mañana queda dentro del día', ({ assert }) => {
    const { startsAt, endsAt } = shiftWindowFor(SHIFTS[0], '2026-08-24')
    assert.equal(startsAt.hour, 8)
    assert.equal(endsAt.hour, 16)
    assert.equal(endsAt.toISODate(), '2026-08-24')
  })
})

test.group('samePlacement', () => {
  // La comparación va sobre (turno, fecha), no solo el nombre: si alguien se olvidó de
  // cerrar el Tarde del 24 y son las 17:00 del 25, el nombre coincide pero hay que rotar.
  test('mismo nombre y distinta fecha NO son la misma sesión', ({ assert }) => {
    assert.isFalse(
      samePlacement(
        { shiftName: 'Tarde', businessDate: '2026-08-24' },
        { shiftName: 'Tarde', businessDate: '2026-08-25' }
      )
    )
  })

  test('mismo nombre y misma fecha son la misma sesión', ({ assert }) => {
    assert.isTrue(
      samePlacement(
        { shiftName: 'Tarde', businessDate: '2026-08-24' },
        { shiftName: 'Tarde', businessDate: '2026-08-24' }
      )
    )
  })
})
