import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import Product from '#models/product'
import { createAdmin, createProduct, createStaff, openCashSession } from './fixtures.js'

/**
 * Behavior of the POS: what a sale does to stock, what it refuses to do, and
 * what cancelling puts back. `commerce_permissions.spec.ts` covers WHO may call
 * these; this file assumes the caller is allowed and asks whether the numbers
 * come out right.
 */

/**
 * The typed test client keys responses by PATH, so `.body()` on `/api/v1/sales`
 * is the UNION of what GET (a paginator) and POST (one sale) return, and
 * `/sales/:id` unions the sale with its error body. These narrow at the call
 * site — the assertions below are about values, not about types.
 */
type JsonResponse = { body(): unknown }
const asSale = (r: JsonResponse) =>
  r.body() as {
    id: number
    total: number
    efectivo: number
    status: string
    cancelledBy: number | null
    items: Array<{ productName: string; unitPrice: number; unitCost: number; subtotal: number }>
  }
const asProduct = (r: JsonResponse) => r.body() as { id: number; stock: number; price: number }
const asProductPage = (r: JsonResponse) => r.body() as { data: Array<{ name: string }> }

test.group('sales — creating a sale', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('a sale decrements stock and records a ledger movement', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1500, stock: 10 })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 3 }], efectivo: 4500 })

    response.assertStatus(201)
    assert.equal(response.body().total, 4500)

    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 7)

    const movements = await db
      .from('stock_movements')
      .where('product_id', product.id)
      .where('type', 'sale')
    assert.lengthOf(movements, 1)
    assert.equal(Number(movements[0].quantity), -3)
    assert.equal(Number(movements[0].stock_before), 10)
    assert.equal(Number(movements[0].stock_after), 7)
    assert.equal(Number(movements[0].sale_id), asSale(response).id)
  })

  test('the price comes from the database, not from the request', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 12000, stock: 5 })

    // A client trying to sell a 12k paddle for 1 peso. The field is not even in
    // the validator — the point is that the total ignores it entirely.
    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1, unitPrice: 1 }], efectivo: 12000 })

    response.assertStatus(201)
    assert.equal(response.body().total, 12000)
    assert.equal(asSale(response).items[0].unitPrice, 12000)
  })

  test('an all-zero split on a non-zero sale is taken as all cash', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 2000, stock: 5 })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 2 }] })

    response.assertStatus(201)
    assert.equal(asSale(response).efectivo, 4000)
    assert.equal(response.body().total, 4000)
  })

  test('a split that does not add up to the total is rejected', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 2000, stock: 5 })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 2 }], efectivo: 1000 })

    response.assertStatus(400)

    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 5, 'a rejected sale must not move stock')
  })

  test('selling more than there is, is refused and moves nothing', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1000, stock: 2 })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 3 }], efectivo: 3000 })

    response.assertStatus(400)

    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 2)
    const movements = await db.from('stock_movements').where('product_id', product.id)
    assert.lengthOf(movements, 0)
  })

  test('the same product twice is merged, so the stock check sees the real quantity', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1000, stock: 3 })

    // 2 + 2 = 4 against a stock of 3. Checked line by line, both lines pass.
    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({
        items: [
          { productId: product.id, quantity: 2 },
          { productId: product.id, quantity: 2 },
        ],
        efectivo: 4000,
      })

    response.assertStatus(400)
    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 3)
  })

  test('an inactive product cannot be sold', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1000, stock: 5, isActive: false })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 1000 })

    response.assertStatus(400)
    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 5)
  })

  test('an untracked product sells without touching stock', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 3000, stock: 0, trackStock: false })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 4 }], efectivo: 12000 })

    response.assertStatus(201)
    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 0, 'untracked stock never goes negative')
  })

  test('the line snapshots name and cost at sale time', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({
      name: 'Pelotitas Head x3',
      price: 8000,
      cost: 5200,
      stock: 4,
    })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 8000 })

    response.assertStatus(201)
    const item = asSale(response).items[0]
    assert.equal(item.productName, 'Pelotitas Head x3')
    assert.equal(item.unitCost, 5200)
    assert.equal(item.subtotal, 8000)
  })
})

test.group('sales — cancelling a sale', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('cancelling puts the stock back and leaves the sale on record', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1000, stock: 10 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 4 }], efectivo: 4000 })
    sale.assertStatus(201)
    const saleId = asSale(sale).id

    const cancelled = await client.delete(`/api/v1/sales/${saleId}`).loginAs(admin)
    cancelled.assertStatus(200)

    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 10)

    const detail = await client.get(`/api/v1/sales/${saleId}`).loginAs(admin)
    detail.assertStatus(200)
    assert.equal(asSale(detail).status, 'cancelled')
    assert.equal(asSale(detail).cancelledBy, admin.id)

    const returns = await db
      .from('stock_movements')
      .where('product_id', product.id)
      .where('type', 'return')
    assert.lengthOf(returns, 1)
    assert.equal(Number(returns[0].quantity), 4)
  })

  test('cancelling twice is refused, so stock is not credited twice', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1000, stock: 10 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 4 }], efectivo: 4000 })
    const saleId = asSale(sale).id

    await client.delete(`/api/v1/sales/${saleId}`).loginAs(admin)
    const second = await client.delete(`/api/v1/sales/${saleId}`).loginAs(admin)

    second.assertStatus(400)
    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 10)
  })
})

test.group('products — stock adjustments', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('an "in" movement adds to stock', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ stock: 5 })

    const response = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(admin)
      .json({ type: 'in', quantity: 12, reason: 'Compra proveedor' })

    response.assertStatus(200)
    assert.equal(response.body().stock, 17)
  })

  test('an adjustment sets the counted total, it does not add to it', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const product = await createProduct({ stock: 20 })

    // Whoever counted the shelf found 14. Not "minus 14".
    const response = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(admin)
      .json({ type: 'adjustment', quantity: 14, reason: 'Conteo físico' })

    response.assertStatus(200)
    assert.equal(response.body().stock, 14)

    const movement = await db
      .from('stock_movements')
      .where('product_id', product.id)
      .where('type', 'adjustment')
      .first()
    assert.equal(Number(movement.quantity), -6)
  })

  test('an "out" bigger than the stock is refused', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ stock: 3 })

    const response = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(admin)
      .json({ type: 'out', quantity: 5, reason: 'Rotura' })

    response.assertStatus(400)
    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 3)
  })

  test('opening stock on create lands in the ledger, not just the column', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()

    const response = await client
      .post('/api/v1/products')
      .loginAs(admin)
      .json({ name: 'Paleta Bullpadel', price: 250000, cost: 180000, stock: 6 })

    response.assertStatus(201)
    assert.equal(asProduct(response).stock, 6)

    const movements = await db.from('stock_movements').where('product_id', asProduct(response).id)
    assert.lengthOf(movements, 1)
    assert.equal(movements[0].type, 'in')
    assert.equal(Number(movements[0].stock_after), 6)
  })

  test('PUT /products cannot move stock — only the stock endpoint can', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const product = await createProduct({ stock: 9, price: 1000 })

    const response = await client
      .put(`/api/v1/products/${product.id}`)
      .loginAs(admin)
      .json({ name: product.name, price: 1200, stock: 999 })

    response.assertStatus(200)
    const after = await Product.findOrFail(product.id)
    assert.equal(after.stock, 9, 'stock must only move through the ledger')
    assert.equal(after.price, 1200)
  })

  test('low stock is flagged against the product minimum', async ({ client, assert }) => {
    const admin = await createAdmin()
    await createProduct({ name: 'Fixture Low', stock: 2, minStock: 5 })

    const response = await client
      .get('/api/v1/products')
      .loginAs(admin)
      .qs({ lowStock: 'true', perPage: 100 })

    response.assertStatus(200)
    const names = asProductPage(response).data.map((p: { name: string }) => p.name)
    assert.include(names, 'Fixture Low')
  })
})

test.group('products — soft delete', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('a deleted product disappears from the catalog but its sale survives', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const admin = await createAdmin()
    const product = await createProduct({ name: 'Fixture Doomed', price: 500, stock: 5 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(staff)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 500 })
    sale.assertStatus(201)

    const removed = await client.delete(`/api/v1/products/${product.id}`).loginAs(admin)
    removed.assertStatus(200)

    const catalog = await client.get('/api/v1/products/catalog').loginAs(admin)
    const names = catalog.body().map((p: { name: string }) => p.name)
    assert.notInclude(names, 'Fixture Doomed')

    const detail = await client.get(`/api/v1/sales/${asSale(sale).id}`).loginAs(admin)
    detail.assertStatus(200)
    assert.equal(asSale(detail).items[0].productName, 'Fixture Doomed')
  })
})
