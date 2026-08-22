import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  createExpense,
  createExpenseCategory,
  createUserWithPermissions,
  todayISODate,
} from './fixtures.js'

/**
 * Los gastos dentro de GET /stats.
 *
 * Dos cosas que este archivo tiene que blindar:
 *
 * 1. `resultadoNeto = cajaGeneral - expenses.total`. Es el número por el que se pidió el
 *    módulo, y es el único de la respuesta que cruza plata que entra con plata que sale.
 * 2. La invariante de canchas NO se toca: `grandTotal = cajaTotal = facturado +
 *    senasSinSaldar` habla solo de plata de cancha. Si un gasto se colara ahí, la
 *    reconciliación dejaría de reconciliar — que es exactamente la razón por la que el
 *    kiosco ya vive en su propio bloque.
 *
 * Se afirma sobre DELTAS, nunca sobre valores absolutos: `.env.test` apunta a la base de
 * dev real, que tiene reservas y ventas de verdad. Un assert absoluto acá pasaría hoy y
 * fallaría mañana por datos que el test no creó.
 */

const STATS_READER = { stats: { view: true }, expenses: { view: true, create: true } }

type StatsBody = {
  cajaGeneral: number
  grandTotal: number
  reconciliation: { total: number; facturado: number; senasSinSaldar: number; cajaTotal: number }
  expenses?: {
    total: number
    efectivo: number
    transferencia: number
    postnet: number
    count: number
    byCategory: { categoryId: number | null; name: string; total: number; count: number }[]
  }
  resultadoNeto?: number
}

async function stats(client: any, user: any, date: string): Promise<StatsBody> {
  const response = await client.get('/api/v1/stats').qs({ period: 'day', date }).loginAs(user)
  response.assertStatus(200)
  return response.body() as StatsBody
}

test.group('stats — gastos y resultado neto', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('el neto es la caja general menos los gastos del período', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()

    const before = await stats(client, actor, today)
    assert.isDefined(before.expenses)
    assert.equal(before.resultadoNeto, before.cajaGeneral - before.expenses!.total)

    await createExpense(actor, { amount: 7500, expenseDate: today })

    const after = await stats(client, actor, today)
    assert.equal(after.expenses!.total, before.expenses!.total + 7500)
    assert.equal(after.expenses!.count, before.expenses!.count + 1)
    // La caja general es BRUTA: los gastos no la mueven, solo mueven el neto.
    assert.equal(after.cajaGeneral, before.cajaGeneral)
    assert.equal(after.resultadoNeto, after.cajaGeneral - after.expenses!.total)
    assert.equal(after.resultadoNeto, before.resultadoNeto! - 7500)
  })

  test('un gasto no toca la reconciliación de canchas', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()

    const before = await stats(client, actor, today)
    await createExpense(actor, { amount: 30000, expenseDate: today })
    const after = await stats(client, actor, today)

    assert.equal(after.grandTotal, before.grandTotal)
    assert.deepEqual(after.reconciliation, before.reconciliation)
    // La invariante sigue cerrando después de cargar el gasto.
    assert.equal(
      after.reconciliation.cajaTotal,
      Math.round((after.reconciliation.facturado + after.reconciliation.senasSinSaldar) * 100) / 100
    )
  })

  test('un gasto anulado no cuenta', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()

    const before = await stats(client, actor, today)
    await createExpense(actor, { amount: 99000, expenseDate: today, status: 'cancelled' })
    const after = await stats(client, actor, today)

    assert.equal(after.expenses!.total, before.expenses!.total)
    assert.equal(after.expenses!.count, before.expenses!.count)
    assert.equal(after.resultadoNeto, before.resultadoNeto)
  })

  // `expense_date` y no `created_at`: la factura de ayer se carga hoy y pertenece a ayer.
  test('el gasto cae en el día de expense_date, no en el de carga', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()
    const longAgo = '2019-03-14'

    const todayBefore = await stats(client, actor, today)
    await createExpense(actor, { amount: 4200, expenseDate: longAgo })

    const todayAfter = await stats(client, actor, today)
    assert.equal(todayAfter.expenses!.total, todayBefore.expenses!.total)

    const thatDay = await stats(client, actor, longAgo)
    assert.equal(thatDay.expenses!.total, 4200)
    assert.equal(thatDay.resultadoNeto, thatDay.cajaGeneral - 4200)
  })

  test('el desglose por forma de pago suma el total', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()

    const before = await stats(client, actor, today)
    await createExpense(actor, {
      amount: 10000,
      expenseDate: today,
      efectivo: 3000,
      transferencia: 7000,
    })
    const after = await stats(client, actor, today)

    assert.equal(after.expenses!.efectivo, before.expenses!.efectivo + 3000)
    assert.equal(after.expenses!.transferencia, before.expenses!.transferencia + 7000)
    assert.equal(after.expenses!.postnet, before.expenses!.postnet)
    assert.equal(
      Math.round(
        (after.expenses!.efectivo + after.expenses!.transferencia + after.expenses!.postnet) * 100
      ) / 100,
      after.expenses!.total
    )
  })
})

test.group('stats — gastos por categoría', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('agrupa por categoría y la suma de los grupos da el total', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()
    const limpieza = await createExpenseCategory(`Limpieza ${Date.now()}`)

    await createExpense(actor, { amount: 2000, expenseDate: today, categoryId: limpieza.id })
    await createExpense(actor, { amount: 3000, expenseDate: today, categoryId: limpieza.id })

    const body = await stats(client, actor, today)
    const limpiezaGroup = body.expenses!.byCategory.find((c) => c.categoryId === limpieza.id)
    assert.isDefined(limpiezaGroup)
    assert.equal(limpiezaGroup!.total, 5000)
    assert.equal(limpiezaGroup!.count, 2)

    const sum = body.expenses!.byCategory.reduce((s, c) => s + c.total, 0)
    assert.equal(Math.round(sum * 100) / 100, body.expenses!.total)
  })

  // Si los sin-categoría se cayeran del GROUP BY, la tabla no sumaría el total de arriba.
  test('los gastos sin categoría aparecen como "Sin categoría"', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()

    await createExpense(actor, { amount: 1234, expenseDate: today, categoryId: null })

    const body = await stats(client, actor, today)
    const uncategorized = body.expenses!.byCategory.find((c) => c.categoryId === null)
    assert.isDefined(uncategorized)
    assert.equal(uncategorized!.name, 'Sin categoría')
    assert.isAtLeast(uncategorized!.total, 1234)
  })

  test('los grupos vienen ordenados de mayor a menor gasto', async ({ client, assert }) => {
    const actor = await createUserWithPermissions(STATS_READER)
    const today = todayISODate()

    const body = await stats(client, actor, today)
    const totals = body.expenses!.byCategory.map((c) => c.total)
    for (let i = 1; i < totals.length; i++) {
      assert.isAtMost(totals[i], totals[i - 1])
    }
  })
})
