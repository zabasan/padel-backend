import { test } from '@japa/runner'
import { diffFields } from '#services/commerce_audit'

/**
 * The pure half of #services/commerce_audit. `diffFields` decides what lands in the audit
 * trail, so its failure mode is not a crash — it is a log that quietly records the wrong
 * thing, or records nothing at all.
 */
test.group('commerce audit — diffFields', () => {
  test('reports only the fields that moved', ({ assert }) => {
    const changes = diffFields(
      { name: 'Grip Wilson', price: 4000, isActive: true },
      { name: 'Grip Wilson Pro', price: 4000, isActive: true },
      ['name', 'price', 'isActive']
    )

    assert.deepEqual(changes, [
      { field: 'name', oldValue: 'Grip Wilson', newValue: 'Grip Wilson Pro' },
    ])
  })

  test('reports nothing when nothing changed', ({ assert }) => {
    const changes = diffFields({ price: 4000 }, { price: 4000 }, ['price'])
    assert.lengthOf(changes, 0)
  })

  test('treats a numeric string and a number as the same value', ({ assert }) => {
    // mysql2 hands DECIMAL back as "4000.00" while the form posts 4000. Without this, every
    // single save would log a price change that never happened.
    const changes = diffFields({ price: '4000.00' }, { price: 4000 }, ['price'])
    assert.lengthOf(changes, 0)
  })

  test('still catches a real price change through the string/number gap', ({ assert }) => {
    const changes = diffFields({ price: '4000.00' }, { price: 4500 }, ['price'])
    assert.deepEqual(changes, [{ field: 'price', oldValue: '4000', newValue: '4500' }])
  })

  test('catches a sub-peso change instead of rounding it away', ({ assert }) => {
    const changes = diffFields({ price: 10.5 }, { price: 10.75 }, ['price'])
    assert.deepEqual(changes, [{ field: 'price', oldValue: '10.5', newValue: '10.75' }])
  })

  test('normalises booleans to true/false, not 1/0', ({ assert }) => {
    const changes = diffFields({ isActive: true }, { isActive: false }, ['isActive'])
    assert.deepEqual(changes, [{ field: 'isActive', oldValue: 'true', newValue: 'false' }])
  })

  test('records null on both sides of an unset value', ({ assert }) => {
    const changes = diffFields({ sku: null }, { sku: 'GRIP-01' }, ['sku'])
    assert.deepEqual(changes, [{ field: 'sku', oldValue: null, newValue: 'GRIP-01' }])

    const cleared = diffFields({ sku: 'GRIP-01' }, { sku: null }, ['sku'])
    assert.deepEqual(cleared, [{ field: 'sku', oldValue: 'GRIP-01', newValue: null }])
  })

  test('treats null and undefined as the same absence', ({ assert }) => {
    assert.lengthOf(diffFields({ sku: null }, { sku: undefined }, ['sku']), 0)
  })

  test('ignores fields absent from the new state instead of logging a false clear', ({
    assert,
  }) => {
    // A partial update that omits `cost` must not be read as "cost was set to null".
    const changes = diffFields({ name: 'Grip', cost: 2000 }, { name: 'Grip Pro' }, [
      'name',
      'cost',
    ])
    assert.deepEqual(changes, [{ field: 'name', oldValue: 'Grip', newValue: 'Grip Pro' }])
  })

  test('ignores fields outside the audited list', ({ assert }) => {
    const changes = diffFields({ stock: 5 }, { stock: 99 }, ['name', 'price'])
    assert.lengthOf(changes, 0)
  })

  test('reports every field that moved, in the order given', ({ assert }) => {
    const changes = diffFields(
      { name: 'A', price: 1, cost: 2 },
      { name: 'B', price: 3, cost: 4 },
      ['name', 'price', 'cost']
    )
    assert.deepEqual(
      changes.map((c) => c.field),
      ['name', 'price', 'cost']
    )
  })
})
