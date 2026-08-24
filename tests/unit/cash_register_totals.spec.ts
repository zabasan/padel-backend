import { test } from '@japa/runner'
import {
  minuteLabel,
  totalsFor,
  type CashMovement,
  type MovementKind,
} from '#services/cash_register'

function mov(
  kind: MovementKind,
  direction: 'in' | 'out',
  split: { efectivo?: number; transferencia?: number; postnet?: number },
  at = '2026-08-24T17:00:00.000-03:00'
): CashMovement {
  const efectivo = split.efectivo ?? 0
  const transferencia = split.transferencia ?? 0
  const postnet = split.postnet ?? 0
  return {
    at,
    kind,
    direction,
    actorId: 1,
    actorName: 'Sofía',
    label: kind,
    reference: null,
    efectivo,
    transferencia,
    postnet,
    total: Math.round((efectivo + transferencia + postnet) * 100) / 100,
  }
}

test.group('totalsFor', () => {
  test('una lista vacía da todo en cero', ({ assert }) => {
    const t = totalsFor([])
    assert.equal(t.in.total, 0)
    assert.equal(t.out.total, 0)
    assert.equal(t.net.total, 0)
    assert.equal(t.expectedEfectivo, 0)
    assert.equal(t.count, 0)
  })

  test('separa entradas de salidas por método', ({ assert }) => {
    const t = totalsFor([
      mov('court_payment', 'in', { efectivo: 12000 }),
      mov('sale', 'in', { postnet: 3500 }),
      mov('court_payment', 'in', { efectivo: 5000, transferencia: 5000 }),
      mov('expense', 'out', { efectivo: 2000 }),
    ])

    assert.deepEqual(t.in, { efectivo: 17000, transferencia: 5000, postnet: 3500, total: 25500 })
    assert.deepEqual(t.out, { efectivo: 2000, transferencia: 0, postnet: 0, total: 2000 })
    assert.deepEqual(t.net, { efectivo: 15000, transferencia: 5000, postnet: 3500, total: 23500 })
    assert.equal(t.count, 4)
  })

  // Entradas y salidas van SEPARADAS y no neteadas de entrada: cobrar 50.000 y pagar
  // 3.000 de un gasto no es lo mismo que cobrar 47.000, y el arqueo necesita el detalle.
  test('el neto no borra la información de bruto', ({ assert }) => {
    const t = totalsFor([
      mov('court_payment', 'in', { efectivo: 50000 }),
      mov('expense', 'out', { efectivo: 3000 }),
    ])
    assert.equal(t.in.efectivo, 50000)
    assert.equal(t.out.efectivo, 3000)
    assert.equal(t.net.efectivo, 47000)
  })

  // Un cobro hecho y revertido dentro del mismo turno aparece dos veces y netea cero.
  // El turno muestra que pasó en lugar de fingir que nunca ocurrió.
  test('un cobro revertido en el mismo turno netea cero pero deja los dos movimientos', ({
    assert,
  }) => {
    const t = totalsFor([
      mov('court_payment', 'in', { efectivo: 8000 }),
      mov('payment_reverted', 'out', { efectivo: 8000 }),
    ])
    assert.equal(t.net.efectivo, 0)
    assert.equal(t.in.efectivo, 8000)
    assert.equal(t.out.efectivo, 8000)
    assert.equal(t.count, 2, 'los dos hechos quedan visibles')
  })

  test('una venta anulada resta, y un gasto anulado suma', ({ assert }) => {
    const t = totalsFor([
      mov('sale_cancelled', 'out', { efectivo: 1500 }),
      mov('expense_cancelled', 'in', { efectivo: 2000 }),
    ])
    assert.equal(t.net.efectivo, 500)
  })

  test('el efectivo esperado incluye el fondo de caja', ({ assert }) => {
    const t = totalsFor(
      [mov('court_payment', 'in', { efectivo: 20000 }), mov('expense', 'out', { efectivo: 3000 })],
      10000
    )
    // 10.000 de fondo + 20.000 cobrados − 3.000 pagados
    assert.equal(t.expectedEfectivo, 27000)
  })

  // El efectivo esperado mira SOLO efectivo: una transferencia no entra al cajón.
  test('transferencia y postnet no cuentan en el efectivo esperado', ({ assert }) => {
    const t = totalsFor(
      [mov('court_payment', 'in', { transferencia: 40000, postnet: 25000 })],
      5000
    )
    assert.equal(t.expectedEfectivo, 5000)
    assert.equal(t.net.total, 65000)
  })

  test('los centavos no acumulan error de punto flotante', ({ assert }) => {
    const t = totalsFor([
      mov('sale', 'in', { efectivo: 0.1 }),
      mov('sale', 'in', { efectivo: 0.2 }),
    ])
    assert.equal(t.in.efectivo, 0.3)
  })
})

test.group('minuteLabel', () => {
  test('formatea el minuto del día como hora', ({ assert }) => {
    assert.equal(minuteLabel(480), '08:00')
    assert.equal(minuteLabel(960), '16:00')
    assert.equal(minuteLabel(1440), '24:00')
    assert.equal(minuteLabel(510), '08:30')
  })
})
