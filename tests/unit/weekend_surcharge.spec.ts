import { test } from '@japa/runner'

// ─── Helper (mirrors reservations_controller.ts) ─────────────────────────────

function calculateWeekendSurcharge(price: number, isWeekend: boolean): number {
  if (isWeekend) return price * 1.2
  return price
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.group('calculateWeekendSurcharge — football weekend surcharge', () => {
  test('applies 20% surcharge when isWeekend is true', ({ assert }) => {
    assert.equal(calculateWeekendSurcharge(100, true), 120)
  })

  test('returns price unchanged when isWeekend is false', ({ assert }) => {
    assert.equal(calculateWeekendSurcharge(100, false), 100)
  })

  test('surcharge works with non-round prices', ({ assert }) => {
    assert.closeTo(calculateWeekendSurcharge(75, true), 90, 0.001)
  })

  test('surcharge works with zero price', ({ assert }) => {
    assert.equal(calculateWeekendSurcharge(0, true), 0)
  })

  test('no surcharge for zero price on weekday', ({ assert }) => {
    assert.equal(calculateWeekendSurcharge(0, false), 0)
  })

  test('surcharge multiplier is exactly 1.2', ({ assert }) => {
    const price = 200
    assert.equal(calculateWeekendSurcharge(price, true), price * 1.2)
  })
})
