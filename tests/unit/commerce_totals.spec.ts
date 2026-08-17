import { test } from '@japa/runner'
import {
  lineSubtotal,
  paymentMatchesTotal,
  paymentSum,
  round2,
  saleTotal,
  signedDelta,
} from '#services/commerce'

/**
 * The pure half of #services/commerce — no DB, no HTTP. Everything here is
 * arithmetic that decides whether a sale is accepted and which way stock moves,
 * so it gets tested in isolation from the transaction machinery that uses it.
 */
test.group('commerce — money arithmetic', () => {
  test('round2 kills binary floating point residue', ({ assert }) => {
    assert.equal(round2(0.1 + 0.2), 0.3)
    assert.equal(round2(1.005), 1.01)
    assert.equal(round2(2999.999), 3000)
  })

  test('lineSubtotal multiplies and rounds once', ({ assert }) => {
    assert.equal(lineSubtotal({ unitPrice: 1500.5, quantity: 3 }), 4501.5)
    assert.equal(lineSubtotal({ unitPrice: 33.33, quantity: 3 }), 99.99)
  })

  test('saleTotal adds every line', ({ assert }) => {
    const total = saleTotal([
      { unitPrice: 12000, quantity: 1 },
      { unitPrice: 1500, quantity: 2 },
      { unitPrice: 800.5, quantity: 4 },
    ])
    assert.equal(total, 18202)
  })

  test('saleTotal of no lines is zero, not NaN', ({ assert }) => {
    assert.equal(saleTotal([]), 0)
  })
})

test.group('commerce — payment split validation', () => {
  test('a split adding up to the total is accepted', ({ assert }) => {
    assert.isTrue(
      paymentMatchesTotal(18202, { efectivo: 10000, transferencia: 5000, postnet: 3202 })
    )
  })

  test('paymentSum adds the three methods', ({ assert }) => {
    assert.equal(paymentSum({ efectivo: 100.5, transferencia: 0, postnet: 49.5 }), 150)
  })

  test('a one-cent drift is tolerated — the client adds the same decimals in float', ({
    assert,
  }) => {
    assert.isTrue(paymentMatchesTotal(100, { efectivo: 99.99, transferencia: 0, postnet: 0 }))
    assert.isTrue(paymentMatchesTotal(100, { efectivo: 100.01, transferencia: 0, postnet: 0 }))
  })

  test('anything wider than a cent is a real miscount and is rejected', ({ assert }) => {
    assert.isFalse(paymentMatchesTotal(100, { efectivo: 99.5, transferencia: 0, postnet: 0 }))
    assert.isFalse(paymentMatchesTotal(100, { efectivo: 0, transferencia: 0, postnet: 0 }))
    assert.isFalse(paymentMatchesTotal(100, { efectivo: 200, transferencia: 0, postnet: 0 }))
  })

  test('a zero-total sale needs a zero split', ({ assert }) => {
    assert.isTrue(paymentMatchesTotal(0, { efectivo: 0, transferencia: 0, postnet: 0 }))
    assert.isFalse(paymentMatchesTotal(0, { efectivo: 50, transferencia: 0, postnet: 0 }))
  })
})

test.group('commerce — stock movement direction', () => {
  test('in and return add, out and sale subtract', ({ assert }) => {
    assert.equal(signedDelta('in', 5), 5)
    assert.equal(signedDelta('return', 3), 3)
    assert.equal(signedDelta('out', 2), -2)
    assert.equal(signedDelta('sale', 4), -4)
  })

  test('direction comes from the type, never from the caller sign', ({ assert }) => {
    // A restock sent as -5 must still ADD 5. Otherwise a sign slip at a call
    // site silently inverts an inventory movement.
    assert.equal(signedDelta('in', -5), 5)
    assert.equal(signedDelta('sale', -4), -4)
  })

  test('adjustment is the one type that keeps the caller sign', ({ assert }) => {
    assert.equal(signedDelta('adjustment', 7), 7)
    assert.equal(signedDelta('adjustment', -7), -7)
  })
})
