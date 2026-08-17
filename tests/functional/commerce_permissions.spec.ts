import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { setUserPermission } from '#services/permissions'
import { createAdmin, createCustomer, createProduct, createWorker } from './fixtures.js'

/**
 * Wiring proof for the two commerce modules, in the same spirit as
 * route_permission_wiring.spec.ts: that each route carries the annotation it is
 * supposed to carry, and that the seeded matrix means what it says.
 *
 * The one that actually matters is the products/sales SPLIT — the whole reason
 * commerce ships as two modules instead of one. A worker holds `products.vu`
 * and `sales.vc`: sells, restocks, and cannot reprice or void.
 */

// The typed client keys `.body()` by PATH, so a path serving both a list and a
// single record yields the union of both. Same narrowing helper as
// commerce_sales.spec.ts — see the note there.
type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

test.group('commerce permissions — customers are locked out entirely', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('customer cannot list products', async ({ client }) => {
    const customer = await createCustomer()
    const response = await client.get('/api/v1/products').loginAs(customer)
    response.assertStatus(403)
  })

  test('customer cannot read the POS catalog', async ({ client }) => {
    const customer = await createCustomer()
    const response = await client.get('/api/v1/products/catalog').loginAs(customer)
    response.assertStatus(403)
  })

  test('customer cannot list sales', async ({ client }) => {
    const customer = await createCustomer()
    const response = await client.get('/api/v1/sales').loginAs(customer)
    response.assertStatus(403)
  })

  test('customer cannot create a sale', async ({ client }) => {
    const customer = await createCustomer()
    const product = await createProduct()
    const response = await client
      .post('/api/v1/sales')
      .loginAs(customer)
      .json({ items: [{ productId: product.id, quantity: 1 }] })
    response.assertStatus(403)
  })
})

test.group('commerce permissions — the worker split', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('worker can read the catalog and sell', async ({ client }) => {
    const worker = await createWorker()
    const product = await createProduct({ price: 900, stock: 5 })

    const catalog = await client.get('/api/v1/products/catalog').loginAs(worker)
    catalog.assertStatus(200)

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(worker)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 900 })
    sale.assertStatus(201)
  })

  test('worker can restock — `products.update` covers the stock endpoint', async ({ client }) => {
    const worker = await createWorker()
    const product = await createProduct({ stock: 1 })
    const response = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(worker)
      .json({ type: 'in', quantity: 5, reason: 'Reposición' })
    response.assertStatus(200)
  })

  // These four assert the products/sales VERB split itself — holding view+update
  // on a module must not imply create/erase — so they use a permission grant
  // scoped to exactly that, rather than the `worker` role. Which roles hold which
  // verbs is a business call made through the Roles ABM and can change without
  // this file going red; see engram (padel) for the tracked follow-up to convert
  // the rest of this suite the same way.
  test('holding products.view+update does NOT grant products.create — that is the price list', async ({
    client,
  }) => {
    const seller = await createCustomer()
    await setUserPermission(seller.id, 'products', {
      view: true,
      create: false,
      update: true,
      erase: false,
    })
    const response = await client
      .post('/api/v1/products')
      .loginAs(seller)
      .json({ name: 'Paleta trucha', price: 1 })
    response.assertStatus(403)
  })

  test('holding products.view+update does NOT grant products.erase', async ({ client }) => {
    const seller = await createCustomer()
    await setUserPermission(seller.id, 'products', {
      view: true,
      create: false,
      update: true,
      erase: false,
    })
    const product = await createProduct()
    const response = await client.delete(`/api/v1/products/${product.id}`).loginAs(seller)
    response.assertStatus(403)
  })

  test('holding sales.view+create does NOT grant sales.erase — cannot void a sale', async ({
    client,
  }) => {
    const seller = await createCustomer()
    await setUserPermission(seller.id, 'sales', {
      view: true,
      create: true,
      update: false,
      erase: false,
    })
    const admin = await createAdmin()
    const product = await createProduct({ price: 900, stock: 5 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 900 })

    const response = await client.delete(`/api/v1/sales/${idOf(sale)}`).loginAs(seller)
    response.assertStatus(403)
  })

  test('holding products.view+update does NOT grant category creation — categories gate on products.create', async ({
    client,
  }) => {
    const seller = await createCustomer()
    await setUserPermission(seller.id, 'products', {
      view: true,
      create: false,
      update: true,
      erase: false,
    })
    const response = await client
      .post('/api/v1/product-categories')
      .loginAs(seller)
      .json({ name: 'Categoría trucha' })
    response.assertStatus(403)
  })
})

test.group('commerce permissions — admin holds everything', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin can run the full product lifecycle', async ({ client, assert }) => {
    const admin = await createAdmin()

    const created = await client
      .post('/api/v1/products')
      .loginAs(admin)
      .json({ name: 'Fixture Lifecycle', price: 5000, cost: 3000, stock: 2, minStock: 1 })
    created.assertStatus(201)
    const id = idOf(created)

    const updated = await client
      .put(`/api/v1/products/${id}`)
      .loginAs(admin)
      .json({ name: 'Fixture Lifecycle', price: 6000 })
    updated.assertStatus(200)

    const toggled = await client.patch(`/api/v1/products/${id}/toggle`).loginAs(admin)
    toggled.assertStatus(200)

    const movements = await client.get(`/api/v1/products/${id}/movements`).loginAs(admin)
    movements.assertStatus(200)

    const deleted = await client.delete(`/api/v1/products/${id}`).loginAs(admin)
    deleted.assertStatus(200)

    const gone = await client.get(`/api/v1/products/${id}`).loginAs(admin)
    assert.equal(gone.status(), 404)
  })

  // The list is the only endpoint that touches the ProductCategory.products relation (via
  // withCount). It went 500 in the browser while every write test here still passed — Lucid
  // derives the foreign key from the model name unless told otherwise.
  test('the categories list returns a product count per category', async ({ client, assert }) => {
    const admin = await createAdmin()

    const created = await client
      .post('/api/v1/product-categories')
      .loginAs(admin)
      .json({ name: 'Fixture Contada' })
    created.assertStatus(201)
    await createProduct({ categoryId: idOf(created) })

    const list = await client.get('/api/v1/product-categories').loginAs(admin)
    list.assertStatus(200)

    const rows = list.body() as Array<{ id: number; name: string; productsCount: number }>
    const row = rows.find((c) => c.name === 'Fixture Contada')
    assert.isDefined(row)
    assert.equal(row!.productsCount, 1)
  })

  test('admin can manage categories', async ({ client }) => {
    const admin = await createAdmin()

    const created = await client
      .post('/api/v1/product-categories')
      .loginAs(admin)
      .json({ name: 'Fixture Categoría' })
    created.assertStatus(201)

    const renamed = await client
      .put(`/api/v1/product-categories/${idOf(created)}`)
      .loginAs(admin)
      .json({ name: 'Fixture Categoría Editada' })
    renamed.assertStatus(200)

    const removed = await client
      .delete(`/api/v1/product-categories/${idOf(created)}`)
      .loginAs(admin)
    removed.assertStatus(200)
  })

  test('duplicate category names are refused', async ({ client }) => {
    const admin = await createAdmin()
    const first = await client
      .post('/api/v1/product-categories')
      .loginAs(admin)
      .json({ name: 'Fixture Dup' })
    first.assertStatus(201)

    const duplicate = await client
      .post('/api/v1/product-categories')
      .loginAs(admin)
      .json({ name: 'fixture dup' })
    duplicate.assertStatus(409)
  })
})
