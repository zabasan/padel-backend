import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { createAdmin, createProduct } from './fixtures.js'

/**
 * Shop sales in the stats screen. The load-bearing assertion here is the LAST one: adding
 * commerce must not disturb the court reconciliation, whose invariant
 * (cajaTotal = facturado + senasSinSaldar) is what makes the revenue screen trustworthy.
 */

type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

interface StatsBody {
  commerce: {
    total: number
    efectivo: number
    transferencia: number
    postnet: number
    salesCount: number
    unitsSold: number
    cost: number
    margin: number
    topProducts: Array<{ name: string; units: number; revenue: number }>
  }
  cajaGeneral: number
  reconciliation: { cajaTotal: number; facturado: number; senasSinSaldar: number }
}

function todayART() {
  return DateTime.now().setZone('America/Argentina/Buenos_Aires').toISODate()!
}

async function statsToday(client: any, admin: any): Promise<StatsBody> {
  const response = await client
    .get('/api/v1/stats')
    .loginAs(admin)
    .qs({ period: 'day', date: todayART() })
  response.assertStatus(200)
  return response.body() as StatsBody
}

test.group('stats — commerce block', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a sale shows up in the commerce block', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ name: 'Fixture Grip', price: 4000, cost: 2500, stock: 10 })

    const before = await statsToday(client, admin)

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 3 }], efectivo: 12000 })
    sale.assertStatus(201)

    const after = await statsToday(client, admin)

    assert.equal(after.commerce.total - before.commerce.total, 12000)
    assert.equal(after.commerce.salesCount - before.commerce.salesCount, 1)
    assert.equal(after.commerce.unitsSold - before.commerce.unitsSold, 3)
    assert.equal(after.commerce.efectivo - before.commerce.efectivo, 12000)
  })

  test('margin uses the cost snapshotted at sale time', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ name: 'Fixture Margen', price: 5000, cost: 3000, stock: 10 })

    const before = await statsToday(client, admin)

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 2 }], efectivo: 10000 })
    sale.assertStatus(201)

    // Repricing the cost AFTER the sale must not move the margin already earned.
    const repriced = await client
      .put(`/api/v1/products/${product.id}`)
      .loginAs(admin)
      .json({ name: 'Fixture Margen', price: 5000, cost: 9999 })
    repriced.assertStatus(200)

    const after = await statsToday(client, admin)

    assert.equal(after.commerce.cost - before.commerce.cost, 6000)
    assert.equal(after.commerce.margin - before.commerce.margin, 4000)
  })

  test('the payment split is broken out by method', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 10000, stock: 10 })

    const before = await statsToday(client, admin)

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({
        items: [{ productId: product.id, quantity: 1 }],
        efectivo: 4000,
        transferencia: 3500,
        postnet: 2500,
      })
    sale.assertStatus(201)

    const after = await statsToday(client, admin)
    assert.equal(after.commerce.efectivo - before.commerce.efectivo, 4000)
    assert.equal(after.commerce.transferencia - before.commerce.transferencia, 3500)
    assert.equal(after.commerce.postnet - before.commerce.postnet, 2500)
  })

  test('a cancelled sale drops back out of the stats', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 7000, stock: 10 })

    const before = await statsToday(client, admin)

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 7000 })
    sale.assertStatus(201)

    const cancelled = await client.delete(`/api/v1/sales/${idOf(sale)}`).loginAs(admin)
    cancelled.assertStatus(200)

    const after = await statsToday(client, admin)
    assert.equal(after.commerce.total, before.commerce.total, 'a voided ticket collected nothing')
    assert.equal(after.commerce.salesCount, before.commerce.salesCount)
  })

  test('top products are ranked by revenue', async ({ client, assert }) => {
    const admin = await createAdmin()
    const cheap = await createProduct({ name: 'Fixture Barato', price: 500, stock: 100 })
    const dear = await createProduct({ name: 'Fixture Caro', price: 90000, stock: 100 })

    await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: cheap.id, quantity: 10 }], efectivo: 5000 })
    await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: dear.id, quantity: 1 }], efectivo: 90000 })

    const stats = await statsToday(client, admin)
    const names = stats.commerce.topProducts.map((p) => p.name)
    assert.isBelow(
      names.indexOf('Fixture Caro'),
      names.indexOf('Fixture Barato'),
      'ranked by revenue, not by units'
    )
  })

  test('the payment-method filter narrows the commerce total too', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 10000, stock: 10 })

    await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({
        items: [{ productId: product.id, quantity: 1 }],
        efectivo: 6000,
        transferencia: 4000,
      })

    const cashOnly = await client
      .get('/api/v1/stats')
      .loginAs(admin)
      .qs({ period: 'day', date: todayART(), paymentMethod: 'efectivo' })
    cashOnly.assertStatus(200)

    const body = cashOnly.body() as StatsBody
    assert.equal(body.commerce.total, body.commerce.efectivo)
  })
})

test.group('stats — commerce does not corrupt the court numbers', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('the court reconciliation still balances after a shop sale', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 25000, stock: 10 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 25000 })
    sale.assertStatus(201)

    const stats = await statsToday(client, admin)
    const { cajaTotal, facturado, senasSinSaldar } = stats.reconciliation

    // The invariant the revenue screen rests on. Folding shop sales into paymentBreakdown
    // would break it — which is exactly why commerce is its own block.
    assert.equal(
      Math.round((facturado + senasSinSaldar) * 100) / 100,
      cajaTotal,
      'court reconciliation must stay about court money only'
    )
  })

  test('cajaGeneral is courts plus shop', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 8000, stock: 10 })

    await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 8000 })

    const stats = await statsToday(client, admin)
    assert.equal(
      stats.cajaGeneral,
      Math.round((stats.reconciliation.cajaTotal + stats.commerce.total) * 100) / 100
    )
  })
})
