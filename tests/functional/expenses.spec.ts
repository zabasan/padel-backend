import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CommerceAuditLog from '#models/commerce_audit_log'
import Expense from '#models/expense'
import {
  createExpense,
  createExpenseCategory,
  createUserWithPermissions,
  todayISODate,
} from './fixtures.js'

/**
 * Cableado y comportamiento del módulo `expenses`.
 *
 * TODO se afirma contra un PERMISO, nunca contra un nombre de rol: quién carga gastos es
 * una decisión de negocio que el ABM de Roles cambia en runtime (hoy es solo admin, mañana
 * puede ser el supervisor), mientras que "esta ruta está gateada en este {módulo, acción}"
 * es el contrato del código. Un test atado a `admin` se rompe el día que alguien mueve una
 * casilla en una pantalla, sin que haya ningún bug.
 *
 * El grupo entero corre dentro de una transacción global revertida: `.env.test` apunta a la
 * base de dev real y no existe una base de test aislada.
 */

type JsonResponse = { body(): unknown }
const idOf = (r: JsonResponse) => (r.body() as { id: number }).id

const ALL = { view: true, create: true, update: true, erase: true }

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Papel higiénico x24',
    amount: 12000,
    expenseDate: todayISODate(),
    ...overrides,
  }
}

test.group('expenses — sin el permiso no hay gastos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un usuario sin `expenses` queda afuera de todas las rutas de gasto', async ({ client }) => {
    const nobody = await createUserWithPermissions()
    const expense = await createExpense(nobody)

    const responses = await Promise.all([
      client.get('/api/v1/expenses').loginAs(nobody),
      client.get(`/api/v1/expenses/${expense.id}`).loginAs(nobody),
      client.post('/api/v1/expenses').loginAs(nobody).json(validPayload()),
      client.put(`/api/v1/expenses/${expense.id}`).loginAs(nobody).json(validPayload()),
      client.delete(`/api/v1/expenses/${expense.id}`).loginAs(nobody),
      client.get('/api/v1/expense-categories').loginAs(nobody),
      client.post('/api/v1/expense-categories').loginAs(nobody).json({ name: 'Trucha' }),
    ])
    for (const response of responses) response.assertStatus(403)
  })

  // El punto de que `expenses` sea un módulo aparte: vender no implica poder tocar los
  // gastos del complejo, ni al revés.
  test('todo el comercio concedido NO abre los gastos', async ({ client }) => {
    const seller = await createUserWithPermissions({ products: ALL, sales: ALL })

    const list = await client.get('/api/v1/expenses').loginAs(seller)
    list.assertStatus(403)

    const create = await client.post('/api/v1/expenses').loginAs(seller).json(validPayload())
    create.assertStatus(403)
  })

  test('`stats.view` sin `expenses.view` no trae el bloque de gastos ni el neto', async ({
    client,
    assert,
  }) => {
    const analyst = await createUserWithPermissions({ stats: { view: true } })
    const response = await client.get('/api/v1/stats').loginAs(analyst)

    response.assertStatus(200)
    const body = response.body() as Record<string, unknown>
    // Mandar el neto sin el detalle sería peor que no mandar nada: un número que no se
    // puede explicar con lo que hay en pantalla.
    assert.isUndefined(body.expenses)
    assert.isUndefined(body.resultadoNeto)
    assert.isNumber(body.cajaGeneral)
  })
})

test.group('expenses — cada verbo en su permiso', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('`expenses.view` lee pero NO carga', async ({ client }) => {
    const reader = await createUserWithPermissions({ expenses: { view: true } })

    const list = await client.get('/api/v1/expenses').loginAs(reader)
    list.assertStatus(200)

    const categories = await client.get('/api/v1/expense-categories').loginAs(reader)
    categories.assertStatus(200)

    const create = await client.post('/api/v1/expenses').loginAs(reader).json(validPayload())
    create.assertStatus(403)
  })

  test('`expenses.create` carga pero NO edita ni anula', async ({ client }) => {
    const loader = await createUserWithPermissions({ expenses: { view: true, create: true } })

    const created = await client.post('/api/v1/expenses').loginAs(loader).json(validPayload())
    created.assertStatus(201)
    const id = idOf(created)

    const edit = await client
      .put(`/api/v1/expenses/${id}`)
      .loginAs(loader)
      .json(validPayload({ amount: 1 }))
    edit.assertStatus(403)

    const cancel = await client.delete(`/api/v1/expenses/${id}`).loginAs(loader)
    cancel.assertStatus(403)
  })

  test('`expenses.update` edita pero NO anula', async ({ client }) => {
    const editor = await createUserWithPermissions({ expenses: { view: true, update: true } })
    const expense = await createExpense(editor)

    const edit = await client
      .put(`/api/v1/expenses/${expense.id}`)
      .loginAs(editor)
      .json(validPayload({ description: 'Pintura latex 20L', amount: 45000 }))
    edit.assertStatus(200)

    const cancel = await client.delete(`/api/v1/expenses/${expense.id}`).loginAs(editor)
    cancel.assertStatus(403)
  })

  test('`expenses.erase` anula', async ({ client }) => {
    const canceller = await createUserWithPermissions({ expenses: { view: true, erase: true } })
    const expense = await createExpense(canceller)

    const cancel = await client.delete(`/api/v1/expenses/${expense.id}`).loginAs(canceller)
    cancel.assertStatus(200)
  })
})

test.group('expenses — desglose de pago', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // El caso abrumadoramente común: se pagó del cajón. Rechazarlo por un campo sin tocar
  // sería pelearle al usuario por nada. Misma decisión que sales_controller.store.
  test('sin desglose, todo va a efectivo', async ({ client, assert }) => {
    const loader = await createUserWithPermissions({ expenses: ALL })

    const created = await client
      .post('/api/v1/expenses')
      .loginAs(loader)
      .json(validPayload({ amount: 8500 }))
    created.assertStatus(201)

    const expense = await Expense.findOrFail(idOf(created))
    assert.equal(expense.efectivo, 8500)
    assert.equal(expense.transferencia, 0)
    assert.equal(expense.postnet, 0)
  })

  test('un desglose que suma el monto se guarda tal cual', async ({ client, assert }) => {
    const loader = await createUserWithPermissions({ expenses: ALL })

    const created = await client
      .post('/api/v1/expenses')
      .loginAs(loader)
      .json(validPayload({ amount: 10000, efectivo: 4000, transferencia: 6000 }))
    created.assertStatus(201)

    const expense = await Expense.findOrFail(idOf(created))
    assert.equal(expense.efectivo, 4000)
    assert.equal(expense.transferencia, 6000)
    assert.equal(expense.postnet, 0)
  })

  test('un desglose que no cierra contra el monto es 400', async ({ client }) => {
    const loader = await createUserWithPermissions({ expenses: ALL })

    const created = await client
      .post('/api/v1/expenses')
      .loginAs(loader)
      .json(validPayload({ amount: 10000, efectivo: 4000, transferencia: 1000 }))
    created.assertStatus(400)
  })

  test('un gasto en cero es válido y no se fuerza a efectivo', async ({ client, assert }) => {
    const loader = await createUserWithPermissions({ expenses: ALL })

    const created = await client
      .post('/api/v1/expenses')
      .loginAs(loader)
      .json(validPayload({ amount: 0 }))
    created.assertStatus(201)

    const expense = await Expense.findOrFail(idOf(created))
    assert.equal(expense.amount, 0)
    assert.equal(expense.efectivo, 0)
  })
})

test.group('expenses — anular, no borrar', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('DELETE deja la fila con status cancelled y quién la anuló', async ({ client, assert }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })
    const expense = await createExpense(actor, { amount: 5000 })

    const cancel = await client.delete(`/api/v1/expenses/${expense.id}`).loginAs(actor)
    cancel.assertStatus(200)

    // Un gasto que desaparece sin rastro es cómo una caja se descuadra en silencio.
    const stored = await Expense.find(expense.id)
    assert.isNotNull(stored)
    assert.equal(stored!.status, 'cancelled')
    assert.equal(stored!.cancelledBy, actor.id)
    assert.isNotNull(stored!.cancelledAt)
    assert.equal(stored!.amount, 5000)
  })

  test('anular dos veces es 400', async ({ client }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })
    const expense = await createExpense(actor, { status: 'cancelled' })

    const cancel = await client.delete(`/api/v1/expenses/${expense.id}`).loginAs(actor)
    cancel.assertStatus(400)
  })

  // Editar un anulado dejaría la fila diciendo una cosa y la anulación otra, y la
  // auditoría no podría reconstruir cuál de las dos pasó.
  test('editar un gasto anulado es 400', async ({ client }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })
    const expense = await createExpense(actor, { status: 'cancelled' })

    const edit = await client
      .put(`/api/v1/expenses/${expense.id}`)
      .loginAs(actor)
      .json(validPayload({ amount: 1 }))
    edit.assertStatus(400)
  })
})

test.group('expenses — categorías', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('no se puede asignar una categoría retirada', async ({ client }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })
    const category = await createExpenseCategory()

    const removed = await client.delete(`/api/v1/expense-categories/${category.id}`).loginAs(actor)
    removed.assertStatus(200)

    const created = await client
      .post('/api/v1/expenses')
      .loginAs(actor)
      .json(validPayload({ categoryId: category.id }))
    created.assertStatus(400)
  })

  // Un gasto archivado bajo una categoría que nadie ve es plata que no aparece en ningún
  // grupo de la pantalla de estadísticas.
  test('retirar una categoría desasocia sus gastos en vez de dejarlos apuntando', async ({
    client,
    assert,
  }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })
    const category = await createExpenseCategory()
    const expense = await createExpense(actor, { categoryId: category.id })

    const removed = await client.delete(`/api/v1/expense-categories/${category.id}`).loginAs(actor)
    removed.assertStatus(200)

    const stored = await Expense.findOrFail(expense.id)
    assert.isNull(stored.categoryId)
  })

  test('dos categorías vivas con el mismo nombre es 409', async ({ client }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })
    const name = `Limpieza ${Date.now()}`

    const first = await client.post('/api/v1/expense-categories').loginAs(actor).json({ name })
    first.assertStatus(201)

    const second = await client
      .post('/api/v1/expense-categories')
      .loginAs(actor)
      .json({ name: name.toUpperCase() })
    second.assertStatus(409)
  })
})

test.group('expenses — auditoría', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function logsFor(entityType: string, entityId: number) {
    return CommerceAuditLog.query()
      .where('entity_type', entityType)
      .where('entity_id', entityId)
      .orderBy('id', 'asc')
  }

  test('el alta, la edición y la anulación quedan registradas', async ({ client, assert }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })

    const created = await client
      .post('/api/v1/expenses')
      .loginAs(actor)
      .json(validPayload({ amount: 12000 }))
    created.assertStatus(201)
    const id = idOf(created)

    await client
      .put(`/api/v1/expenses/${id}`)
      .loginAs(actor)
      .json(validPayload({ amount: 15000 }))
    await client.delete(`/api/v1/expenses/${id}`).loginAs(actor)

    const logs = await logsFor('expense', id)
    const actions = new Set(logs.map((l) => l.action))
    assert.isTrue(actions.has('create'))
    assert.isTrue(actions.has('update'))
    assert.isTrue(actions.has('cancel'))
    for (const log of logs) assert.equal(log.performedBy, actor.id)

    const amountEdit = logs.find((l) => l.action === 'update' && l.field === 'amount')
    assert.isDefined(amountEdit)
    assert.equal(amountEdit!.newValue, '15000')
  })

  // Guardar sin cambiar nada NO es un evento — la guarda vive en logCommerce y esto la pinea
  // para los gastos.
  test('un PUT que no cambia nada no escribe filas de update', async ({ client, assert }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })

    const created = await client.post('/api/v1/expenses').loginAs(actor).json(validPayload())
    const id = idOf(created)

    await client.put(`/api/v1/expenses/${id}`).loginAs(actor).json(validPayload())

    const logs = await logsFor('expense', id)
    const updates = logs.filter((l) => l.action === 'update')
    assert.lengthOf(updates, 0)
  })

  test('las categorías de gasto también se auditan', async ({ client, assert }) => {
    const actor = await createUserWithPermissions({ expenses: ALL })

    const created = await client
      .post('/api/v1/expense-categories')
      .loginAs(actor)
      .json({ name: `Mantenimiento ${Date.now()}` })
    created.assertStatus(201)

    const logs = await logsFor('expense_category', idOf(created))
    assert.isAtLeast(logs.length, 1)
    assert.equal(logs[0].action, 'create')
  })
})
