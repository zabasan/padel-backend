import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import {
  createAdmin,
  createProduct,
  createUserWithPermissions,
  openCashSession,
} from './fixtures.js'

/**
 * "Toda carga de artículos y ventas tiene que estar auditada" — this file is that requirement
 * expressed as tests. Each one asserts the audit ROW exists, not merely that the endpoint
 * returned 200: an audit trail nobody checks is an audit trail that silently stops writing.
 */

type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

async function logsFor(entityType: string, entityId: number) {
  return db
    .from('commerce_audit_logs')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .orderBy('id', 'asc')
}

test.group('commerce audit — products', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('creating a product is audited', async ({ client, assert }) => {
    const admin = await createAdmin()

    const created = await client
      .post('/api/v1/products')
      .loginAs(admin)
      .json({ name: 'Grip Wilson Pro', price: 4000, cost: 2200, stock: 10 })
    created.assertStatus(201)

    const logs = await logsFor('product', idOf(created))
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].action, 'create')
    assert.equal(logs[0].entity_label, 'Grip Wilson Pro')
    assert.equal(Number(logs[0].performed_by), admin.id)
  })

  test('a price change is audited with the old and the new price', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ name: 'Protector Bullpadel', price: 12000 })

    const updated = await client
      .put(`/api/v1/products/${product.id}`)
      .loginAs(admin)
      .json({ name: 'Protector Bullpadel', price: 15000 })
    updated.assertStatus(200)

    const logs = await logsFor('product', product.id)
    const priceLog = logs.find((l) => l.field === 'price')
    assert.isDefined(priceLog, 'the price change must be in the audit trail')
    assert.equal(priceLog!.action, 'update')
    assert.equal(Number(priceLog!.old_value), 12000)
    assert.equal(Number(priceLog!.new_value), 15000)
  })

  test('a save that changes nothing writes no audit noise', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ name: 'Grip Head', price: 3500, cost: 1800 })

    const updated = await client
      .put(`/api/v1/products/${product.id}`)
      .loginAs(admin)
      .json({ name: 'Grip Head', price: 3500, cost: 1800 })
    updated.assertStatus(200)

    const logs = await logsFor('product', product.id)
    assert.deepEqual(
      logs.map((l) => l.field),
      [],
      'opening and saving a form is not an edit'
    )
  })

  test('deactivating a product is audited', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ isActive: true })

    const toggled = await client.patch(`/api/v1/products/${product.id}/toggle`).loginAs(admin)
    toggled.assertStatus(200)

    const logs = await logsFor('product', product.id)
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].field, 'isActive')
    assert.equal(logs[0].old_value, 'true')
    assert.equal(logs[0].new_value, 'false')
  })

  test('deleting a product is audited, and the log keeps the name', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ name: 'Pelotitas Dunlop' })

    const removed = await client.delete(`/api/v1/products/${product.id}`).loginAs(admin)
    removed.assertStatus(200)

    const logs = await logsFor('product', product.id)
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].action, 'delete')
    // The label is a snapshot precisely so this still reads after the product is gone.
    assert.equal(logs[0].entity_label, 'Pelotitas Dunlop')
  })

  test('a stock movement is audited on top of the stock ledger', async ({ client, assert }) => {
    const restocker = await createUserWithPermissions({ products: { view: true, update: true } })
    const product = await createProduct({ stock: 4 })

    const moved = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(restocker)
      .json({ type: 'in', quantity: 6, reason: 'Compra proveedor' })
    moved.assertStatus(200)

    const logs = await logsFor('product', product.id)
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].action, 'stock')
    assert.equal(logs[0].field, 'in')
    assert.equal(Number(logs[0].old_value), 4)
    assert.equal(Number(logs[0].new_value), 10)
    assert.equal(Number(logs[0].performed_by), restocker.id)
  })

  test('a refused stock movement leaves no audit row', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ stock: 2 })

    const refused = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(admin)
      .json({ type: 'out', quantity: 5 })
    refused.assertStatus(400)

    assert.lengthOf(await logsFor('product', product.id), 0)
  })
})

test.group('commerce audit — categories', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('creating and deleting a category is audited', async ({ client, assert }) => {
    const admin = await createAdmin()

    const created = await client
      .post('/api/v1/product-categories')
      .loginAs(admin)
      .json({ name: 'Fixture Accesorios' })
    created.assertStatus(201)
    const categoryId = idOf(created)

    await createProduct({ categoryId })

    const removed = await client.delete(`/api/v1/product-categories/${categoryId}`).loginAs(admin)
    removed.assertStatus(200)

    const logs = await logsFor('category', categoryId)
    assert.lengthOf(logs, 2)
    assert.equal(logs[0].action, 'create')
    assert.equal(logs[1].action, 'delete')
    // How many products were orphaned is not recoverable from the products afterwards.
    assert.equal(logs[1].field, 'detachedProducts')
    assert.equal(Number(logs[1].new_value), 1)
  })
})

test.group('commerce audit — sales', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('a sale is audited with its total and its items', async ({ client, assert }) => {
    const seller = await createUserWithPermissions({ sales: { view: true, create: true } })
    const product = await createProduct({ name: 'Gatorade', price: 2500, stock: 20 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(seller)
      .json({ items: [{ productId: product.id, quantity: 2 }], efectivo: 5000 })
    sale.assertStatus(201)

    const logs = await logsFor('sale', idOf(sale))
    assert.lengthOf(logs, 2)
    assert.equal(logs[0].action, 'create')
    assert.equal(Number(logs.find((l) => l.field === 'total')!.new_value), 5000)
    assert.equal(logs.find((l) => l.field === 'items')!.new_value, '2× Gatorade')
    assert.equal(Number(logs[0].performed_by), seller.id)
  })

  test('cancelling a sale is audited, and names who cancelled it', async ({ client, assert }) => {
    // Two distinct actors, split by VERB: one may only sell, the other may also void.
    // That split is the point of the assertion at the bottom.
    const seller = await createUserWithPermissions({ sales: { view: true, create: true } })
    const voider = await createUserWithPermissions({
      sales: { view: true, create: true, erase: true },
    })
    const product = await createProduct({ price: 1000, stock: 10 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(seller)
      .json({ items: [{ productId: product.id, quantity: 3 }], efectivo: 3000 })
    const saleId = idOf(sale)

    const cancelled = await client.delete(`/api/v1/sales/${saleId}`).loginAs(voider)
    cancelled.assertStatus(200)

    const logs = await logsFor('sale', saleId)
    const cancelLog = logs.find((l) => l.action === 'cancel')
    assert.isDefined(cancelLog)
    // The seller and the person who voided it are different people, and the trail must say so.
    assert.equal(Number(cancelLog!.performed_by), voider.id)
    assert.notEqual(Number(cancelLog!.performed_by), seller.id)
  })

  test('a rejected sale leaves no audit row', async ({ client, assert }) => {
    const admin = await createAdmin()
    const product = await createProduct({ price: 1000, stock: 1 })

    const refused = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 5 }], efectivo: 5000 })
    refused.assertStatus(400)

    const rows = await db.from('commerce_audit_logs').where('entity_type', 'sale')
    const forThisProduct = rows.filter((r) => String(r.new_value ?? '').includes(product.name))
    assert.lengthOf(forThisProduct, 0)
  })
})

test.group('commerce audit — the read endpoint', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('admin can read the commerce audit trail', async ({ client, assert }) => {
    const admin = await createAdmin()
    await client
      .post('/api/v1/products')
      .loginAs(admin)
      .json({ name: 'Fixture Auditado', price: 100 })

    const response = await client.get('/api/v1/audit/commerce').loginAs(admin)
    response.assertStatus(200)

    const body = response.body() as { data: Array<{ entityLabel: string }>; meta: unknown }
    assert.isDefined(body.meta)
    assert.isTrue(body.data.some((row) => row.entityLabel === 'Fixture Auditado'))
  })

  test('it can be filtered to one entity type', async ({ client, assert }) => {
    const admin = await createAdmin()
    await client
      .post('/api/v1/products')
      .loginAs(admin)
      .json({ name: 'Fixture Filtrado', price: 100 })

    const response = await client
      .get('/api/v1/audit/commerce')
      .loginAs(admin)
      .qs({ entityType: 'sale', perPage: 200 })
    response.assertStatus(200)

    const body = response.body() as { data: Array<{ entityType: string }> }
    assert.isTrue(body.data.every((row) => row.entityType === 'sale'))
  })

  // The trail is gated on `audit.view`, NOT on the commerce modules it records.
  // Holding every products and sales verb — i.e. whoever generates these rows —
  // must still not be able to read who did what. Asserted as a permission rather
  // than a role name so a Roles ABM change cannot quietly turn this red.
  // The positive direction (audit.view opens all three audit endpoints) lives in
  // route_permission_wiring.spec.ts.
  test('full commerce access does NOT grant the audit trail — that needs audit.view', async ({
    client,
  }) => {
    const merchant = await createUserWithPermissions({
      products: { view: true, create: true, update: true, erase: true },
      sales: { view: true, create: true, update: true, erase: true },
    })
    const response = await client.get('/api/v1/audit/commerce').loginAs(merchant)
    response.assertStatus(403)
  })

  test('a user holding nothing cannot read it', async ({ client }) => {
    const nobody = await createUserWithPermissions()
    const response = await client.get('/api/v1/audit/commerce').loginAs(nobody)
    response.assertStatus(403)
  })
})
