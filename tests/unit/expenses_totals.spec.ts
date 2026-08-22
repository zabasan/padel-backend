import { test } from '@japa/runner'
import { paymentMatchesTotal, paymentSum } from '#services/commerce'
import { expensesTotal, groupExpensesByCategory, normalizeSplit } from '#services/expenses'

/**
 * Aritmética pura de gastos — sin DB, sin HTTP.
 *
 * El split reusa los helpers de commerce.ts a propósito (misma tolerancia de un centavo
 * para las tres formas de pago en toda la app); acá se prueba que la reutilización es
 * correcta y que lo propio del gasto — anulados y agrupación — se comporta.
 */

test.group('expenses — normalizeSplit', () => {
  test('rellena los tres métodos con cero y redondea a dos decimales', ({ assert }) => {
    assert.deepEqual(normalizeSplit({}), { efectivo: 0, transferencia: 0, postnet: 0 })
    assert.deepEqual(normalizeSplit({ efectivo: 10.005, transferencia: null }), {
      efectivo: 10.01,
      transferencia: 0,
      postnet: 0,
    })
  })

  test('el split normalizado cierra contra el monto', ({ assert }) => {
    const split = normalizeSplit({ efectivo: 5000, transferencia: 5000 })
    assert.equal(paymentSum(split), 10000)
    assert.isTrue(paymentMatchesTotal(10000, split))
    assert.isFalse(paymentMatchesTotal(10001, split))
  })
})

test.group('expenses — expensesTotal', () => {
  test('suma los completados', ({ assert }) => {
    assert.equal(expensesTotal([{ amount: 1500 }, { amount: 2500.5 }, { amount: 0 }]), 4000.5)
  })

  // La regla, no una opción: un gasto anulado no salió de la caja. Si siguiera restando,
  // el neto quedaría mal y nadie lo vería hasta el cierre de mes.
  test('un gasto anulado NO suma', ({ assert }) => {
    assert.equal(
      expensesTotal([
        { amount: 1000, status: 'completed' },
        { amount: 9999, status: 'cancelled' },
      ]),
      1000
    )
  })

  test('una lista vacía da cero, no NaN', ({ assert }) => {
    assert.equal(expensesTotal([]), 0)
  })
})

test.group('expenses — groupExpensesByCategory', () => {
  test('agrupa por categoría y ordena de mayor a menor gasto', ({ assert }) => {
    const groups = groupExpensesByCategory([
      { categoryId: 1, categoryName: 'Limpieza', amount: 1000 },
      { categoryId: 2, categoryName: 'Servicios', amount: 8000 },
      { categoryId: 1, categoryName: 'Limpieza', amount: 500 },
    ])

    assert.deepEqual(groups, [
      { categoryId: 2, name: 'Servicios', total: 8000, count: 1 },
      { categoryId: 1, name: 'Limpieza', total: 1500, count: 2 },
    ])
  })

  // Si los sin-categoría se descartaran, la suma de la tabla no daría el total de arriba,
  // que es el primer control que hace cualquiera al mirar la pantalla.
  test('los gastos sin categoría caen en un único grupo "Sin categoría"', ({ assert }) => {
    const groups = groupExpensesByCategory([
      { categoryId: null, amount: 300 },
      { categoryId: null, categoryName: null, amount: 200 },
      { categoryId: 5, categoryName: 'Insumos', amount: 100 },
    ])

    assert.lengthOf(groups, 2)
    assert.deepEqual(groups[0], { categoryId: null, name: 'Sin categoría', total: 500, count: 2 })
    assert.equal(
      groups.reduce((sum, g) => sum + g.total, 0),
      600
    )
  })

  test('los anulados quedan afuera de los grupos', ({ assert }) => {
    const groups = groupExpensesByCategory([
      { categoryId: 1, categoryName: 'Limpieza', amount: 1000, status: 'completed' },
      { categoryId: 1, categoryName: 'Limpieza', amount: 7000, status: 'cancelled' },
    ])

    assert.deepEqual(groups, [{ categoryId: 1, name: 'Limpieza', total: 1000, count: 1 }])
  })

  test('la suma de los grupos coincide con expensesTotal', ({ assert }) => {
    const rows = [
      { categoryId: 1, categoryName: 'Limpieza', amount: 1234.56 },
      { categoryId: 2, categoryName: 'Servicios', amount: 7890.12 },
      { categoryId: null, amount: 10.01 },
      { categoryId: 2, categoryName: 'Servicios', amount: 500, status: 'cancelled' as const },
    ]

    const grouped = groupExpensesByCategory(rows).reduce((sum, g) => sum + g.total, 0)
    assert.equal(Math.round(grouped * 100) / 100, expensesTotal(rows))
  })
})
