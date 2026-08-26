import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  createAdmin,
  createProduct,
  createUserWithPermissions,
  openCashSession,
} from './fixtures.js'

/**
 * Wiring proof for the two commerce modules, in the same spirit as
 * route_permission_wiring.spec.ts — and on the same terms: every gate is asserted
 * against a PERMISSION, never a role name, because which role sells and which one
 * reprices is a business decision the Roles ABM can change at any time.
 *
 * What actually matters here is the products/sales SPLIT — the whole reason
 * commerce ships as two modules instead of one. Selling and setting prices are
 * different jobs: a kiosk attendant needs `sales.create` WITHOUT `products.update`,
 * or anyone allowed to ring up a sale could rewrite the price list. The tests below
 * pin that split by verb, so it survives any future role reshuffle.
 */

// The typed client keys `.body()` by PATH, so a path serving both a list and a
// single record yields the union of both. Same narrowing helper as
// commerce_sales.spec.ts — see the note there.
type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

test.group('commerce permissions — no commerce grant means no commerce at all', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('a user holding neither products nor sales is locked out of every commerce route', async ({
    client,
  }) => {
    const nobody = await createUserWithPermissions()
    const product = await createProduct()

    const responses = await Promise.all([
      client.get('/api/v1/products').loginAs(nobody),
      client.get('/api/v1/products/catalog').loginAs(nobody),
      client.get('/api/v1/product-categories').loginAs(nobody),
      client.get('/api/v1/sales').loginAs(nobody),
      client
        .post('/api/v1/sales')
        .loginAs(nobody)
        .json({ items: [{ productId: product.id, quantity: 1 }] }),
    ])
    for (const response of responses) response.assertStatus(403)
  })
})

test.group('commerce permissions — the products/sales split', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  // The POS reading endpoints carry `or: { module: 'sales', action: 'create' }` so a
  // grant that only SELLS still opens the till with a populated grid. Without the
  // `or`, a seller would face an empty catalog — this is what proves it is wired.
  test('sales.create alone opens the POS reading endpoints and selling', async ({ client }) => {
    const seller = await createUserWithPermissions({ sales: { view: true, create: true } })
    const product = await createProduct({ price: 900, stock: 5 })

    const catalog = await client.get('/api/v1/products/catalog').loginAs(seller)
    catalog.assertStatus(200)

    const categories = await client.get('/api/v1/product-categories').loginAs(seller)
    categories.assertStatus(200)

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(seller)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 900 })
    sale.assertStatus(201)
  })

  // Selling must NOT imply repricing — the entire reason these are two modules.
  test('sales.create does NOT open the price list', async ({ client }) => {
    const seller = await createUserWithPermissions({ sales: { view: true, create: true } })
    const product = await createProduct({ price: 900 })

    const create = await client
      .post('/api/v1/products')
      .loginAs(seller)
      .json({ name: 'Paleta trucha', price: 1 })
    create.assertStatus(403)

    const reprice = await client
      .put(`/api/v1/products/${product.id}`)
      .loginAs(seller)
      .json({ name: product.name, price: 1 })
    reprice.assertStatus(403)
  })

  test('products.update covers the stock endpoint — restocking is not repricing', async ({
    client,
  }) => {
    const restocker = await createUserWithPermissions({ products: { view: true, update: true } })
    const product = await createProduct({ stock: 1 })
    const response = await client
      .post(`/api/v1/products/${product.id}/stock`)
      .loginAs(restocker)
      .json({ type: 'in', quantity: 5, reason: 'Reposición' })
    response.assertStatus(200)
  })

  // The verb split WITHIN each module: view+update must not leak create or erase.
  test('products.view+update does NOT grant products.create — that is the price list', async ({
    client,
  }) => {
    const restocker = await createUserWithPermissions({ products: { view: true, update: true } })
    const response = await client
      .post('/api/v1/products')
      .loginAs(restocker)
      .json({ name: 'Paleta trucha', price: 1 })
    response.assertStatus(403)
  })

  test('products.view+update does NOT grant products.erase', async ({ client }) => {
    const restocker = await createUserWithPermissions({ products: { view: true, update: true } })
    const product = await createProduct()
    const response = await client.delete(`/api/v1/products/${product.id}`).loginAs(restocker)
    response.assertStatus(403)
  })

  test('sales.view+create does NOT grant sales.erase — cannot void a sale', async ({ client }) => {
    const seller = await createUserWithPermissions({ sales: { view: true, create: true } })
    const admin = await createAdmin()
    const product = await createProduct({ price: 900, stock: 5 })

    const sale = await client
      .post('/api/v1/sales')
      .loginAs(admin)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 900 })

    const response = await client.delete(`/api/v1/sales/${idOf(sale)}`).loginAs(seller)
    response.assertStatus(403)
  })

  test('products.view+update does NOT grant category creation — categories gate on products.create', async ({
    client,
  }) => {
    const restocker = await createUserWithPermissions({ products: { view: true, update: true } })
    const response = await client
      .post('/api/v1/product-categories')
      .loginAs(restocker)
      .json({ name: 'Categoría trucha' })
    response.assertStatus(403)
  })
})

// These exercise the product/category lifecycle end to end, not the permission gates.
// `createAdmin()` is just a convenient actor that holds every commerce verb — the role
// is incidental here, and a full grant expressed as permissions would say the same
// thing more verbosely. The gates themselves are pinned by the groups above.
test.group('commerce — full product lifecycle (permissions not under test)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

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
