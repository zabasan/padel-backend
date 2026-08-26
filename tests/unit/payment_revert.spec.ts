import { test } from '@japa/runner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FakePayment {
  id: number
  type: 'deposit' | 'total'
  total: number
  efectivo: number
  transferencia: number
  postnet: number
  occurrenceDate: string | null
}

interface FakeReservation {
  depositPaid: boolean
  depositPaidAt: string | null
  depositPaidBy: number | null
  depositReceipt: string | null
  totalPaid: boolean
  totalPaidAt: string | null
  totalPaidBy: number | null
  totalReceipt: string | null
  totalPaidCount: number
  payments: FakePayment[]
}

// ─── Logic mirrors (same as controller revertPayment) ─────────────────────────

function applyPaymentRevert(
  reservation: FakeReservation,
  paymentId: number
): {
  reservation: FakeReservation
  auditOldValue: string
} {
  const payment = reservation.payments.find((p) => p.id === paymentId)
  if (!payment) throw new Error('Payment not found')

  const auditOld = JSON.stringify({
    type: payment.type,
    total: payment.total,
    efectivo: payment.efectivo,
    transferencia: payment.transferencia,
    postnet: payment.postnet,
    occurrenceDate: payment.occurrenceDate ?? undefined,
  })

  const updatedPayments = reservation.payments.filter((p) => p.id !== paymentId)
  const updated = { ...reservation, payments: updatedPayments }

  if (payment.type === 'deposit') {
    updated.depositPaid = false
    updated.depositPaidAt = null
    updated.depositPaidBy = null
    updated.depositReceipt = null
  } else {
    const newCount = Math.max((reservation.totalPaidCount ?? 1) - 1, 0)
    updated.totalPaidCount = newCount
    if (newCount === 0) {
      updated.totalPaid = false
      updated.totalPaidAt = null
      updated.totalPaidBy = null
      updated.totalReceipt = null
    }
  }

  return { reservation: updated, auditOldValue: auditOld }
}

function paidOccurrenceDates(payments: FakePayment[]): string[] {
  return payments
    .filter((p) => p.type === 'total' && p.occurrenceDate != null)
    .map((p) => p.occurrenceDate!)
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDeposit(id: number, occurrenceDate: string | null = null): FakePayment {
  return {
    id,
    type: 'deposit',
    total: 5000,
    efectivo: 5000,
    transferencia: 0,
    postnet: 0,
    occurrenceDate,
  }
}

function makeTotal(id: number, occurrenceDate: string | null = null, total = 10000): FakePayment {
  return { id, type: 'total', total, efectivo: total, transferencia: 0, postnet: 0, occurrenceDate }
}

function makeReservation(overrides: Partial<FakeReservation> = {}): FakeReservation {
  return {
    depositPaid: false,
    depositPaidAt: null,
    depositPaidBy: null,
    depositReceipt: null,
    totalPaid: false,
    totalPaidAt: null,
    totalPaidBy: null,
    totalReceipt: null,
    totalPaidCount: 0,
    payments: [],
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.group('revertPayment — deposit', () => {
  test('revertir seña limpia todos los campos de deposit', ({ assert }) => {
    const reservation = makeReservation({
      depositPaid: true,
      depositPaidAt: '2026-07-01T10:00:00',
      depositPaidBy: 1,
      depositReceipt: 'REC-001',
      payments: [makeDeposit(10)],
    })

    const { reservation: updated } = applyPaymentRevert(reservation, 10)

    assert.isFalse(updated.depositPaid)
    assert.isNull(updated.depositPaidAt)
    assert.isNull(updated.depositPaidBy)
    assert.isNull(updated.depositReceipt)
    assert.isEmpty(updated.payments)
  })

  test('revertir seña no modifica el estado total del pago', ({ assert }) => {
    const reservation = makeReservation({
      depositPaid: true,
      totalPaid: true,
      totalPaidCount: 2,
      payments: [makeDeposit(10), makeTotal(11, '2026-07-03'), makeTotal(12, '2026-07-10')],
    })

    const { reservation: updated } = applyPaymentRevert(reservation, 10)

    assert.isTrue(updated.totalPaid)
    assert.equal(updated.totalPaidCount, 2)
    assert.lengthOf(updated.payments, 2)
  })
})

test.group('revertPayment — total (único pago)', () => {
  test('con totalPaidCount = 1 → totalPaid vuelve a false', ({ assert }) => {
    const reservation = makeReservation({
      totalPaid: true,
      totalPaidAt: '2026-07-03T10:00:00',
      totalPaidBy: 1,
      totalPaidCount: 1,
      payments: [makeTotal(20, '2026-07-03')],
    })

    const { reservation: updated } = applyPaymentRevert(reservation, 20)

    assert.isFalse(updated.totalPaid)
    assert.isNull(updated.totalPaidAt)
    assert.isNull(updated.totalPaidBy)
    assert.equal(updated.totalPaidCount, 0)
    assert.isEmpty(updated.payments)
  })

  test('con totalPaidCount = 0 o undefined → totalPaid vuelve a false (no queda negativo)', ({
    assert,
  }) => {
    const reservation = makeReservation({
      totalPaid: true,
      totalPaidCount: 0,
      payments: [makeTotal(20)],
    })

    const { reservation: updated } = applyPaymentRevert(reservation, 20)

    assert.isFalse(updated.totalPaid)
    assert.equal(updated.totalPaidCount, 0)
  })
})

test.group('revertPayment — total (múltiples pagos recurrentes)', () => {
  test('con totalPaidCount = 3 → baja a 2 y totalPaid sigue en true', ({ assert }) => {
    const reservation = makeReservation({
      totalPaid: true,
      totalPaidCount: 3,
      payments: [
        makeTotal(30, '2026-06-19'),
        makeTotal(31, '2026-06-26'),
        makeTotal(32, '2026-07-03'),
      ],
    })

    const { reservation: updated } = applyPaymentRevert(reservation, 32)

    assert.isTrue(updated.totalPaid)
    assert.equal(updated.totalPaidCount, 2)
    assert.lengthOf(updated.payments, 2)
  })

  test('REGRESIÓN: revertir el pago de una semana no afecta las otras ocurrencias pagas', ({
    assert,
  }) => {
    const payments = [makeTotal(30, '2026-07-03'), makeTotal(31, '2026-07-10')]
    const reservation = makeReservation({ totalPaid: true, totalPaidCount: 2, payments })

    // Revertir el pago del 3 de julio
    const { reservation: updated } = applyPaymentRevert(reservation, 30)

    const paidDates = paidOccurrenceDates(updated.payments)
    assert.notInclude(paidDates, '2026-07-03', 'la fecha revertida no debe aparecer como paga')
    assert.include(paidDates, '2026-07-10', 'la otra ocurrencia sigue paga')
  })
})

test.group('revertPayment — audit log', () => {
  test('el oldValue contiene tipo, monto, método y occurrenceDate del pago original', ({
    assert,
  }) => {
    const payment = makeTotal(40, '2026-07-03', 8500)
    payment.efectivo = 3500
    payment.transferencia = 5000
    payment.postnet = 0

    const reservation = makeReservation({ totalPaid: true, totalPaidCount: 1, payments: [payment] })
    const { auditOldValue } = applyPaymentRevert(reservation, 40)

    const parsed = JSON.parse(auditOldValue)
    assert.equal(parsed.type, 'total')
    assert.equal(parsed.total, 8500)
    assert.equal(parsed.efectivo, 3500)
    assert.equal(parsed.transferencia, 5000)
    assert.equal(parsed.postnet, 0)
    assert.equal(parsed.occurrenceDate, '2026-07-03')
  })

  test('para pagos sin occurrenceDate, el campo es undefined en el audit', ({ assert }) => {
    const payment = makeDeposit(50, null)
    const reservation = makeReservation({ depositPaid: true, payments: [payment] })
    const { auditOldValue } = applyPaymentRevert(reservation, 50)

    const parsed = JSON.parse(auditOldValue)
    assert.notProperty(parsed, 'occurrenceDate')
  })
})

test.group('revertPayment — eliminación del payment del array', () => {
  test('el payment revertido desaparece del array de pagos', ({ assert }) => {
    const payments = [makeDeposit(60), makeTotal(61, '2026-07-03')]
    const reservation = makeReservation({
      depositPaid: true,
      totalPaid: true,
      totalPaidCount: 1,
      payments,
    })

    const { reservation: updated } = applyPaymentRevert(reservation, 61)

    assert.isFalse(updated.payments.some((p) => p.id === 61))
    assert.isTrue(updated.payments.some((p) => p.id === 60))
  })
})
