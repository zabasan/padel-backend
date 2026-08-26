import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CashSession from '#models/cash_session'
import ReservationPayment from '#models/reservation_payment'
import Setting from '#models/setting'
import type User from '#models/user'
import { CASH_SHIFTS_KEY, type CashShift } from '#services/cash_shifts'
import {
  closeAmbientCashRegister,
  createCustomer,
  createExpenseCategory,
  createPadelCourt,
  createProduct,
  createRecurringReservation,
  createStaff,
  createUserWithPermissions,
  nowART,
} from './fixtures.js'

/**
 * La caja del complejo: se abre al empezar el turno, se cierra al terminarlo, y
 * mientras está cerrada no se puede registrar plata.
 *
 * TRUCO DE ESTOS TESTS: en vez de mockear el reloj, se mueve la CONFIGURACIÓN DE
 * TURNOS. La lógica que se quiere probar compara el snapshot de turno de la sesión
 * abierta contra el turno que resuelve el reloj AHORA, así que reconfigurar los turnos
 * alrededor del instante actual reproduce exactamente las mismas tres situaciones
 * (turno en curso / sin turno en curso / otro turno en curso) por el camino de código
 * real, sin inyectar tiempo falso en ningún lado.
 *
 * El grupo entero corre en una transacción global revertida, así que nada de lo que
 * escribe sobrevive al test.
 */

const CASH_GRANTS = { cash_register: { view: true, create: true, update: true } }

/**
 * Caja + lo necesario para cobrar una cancha. Sin `payments.create` el pay-total
 * devuelve 403 y el arqueo queda en cero sin que nada avise — un 403 silencioso es la
 * forma más fácil de escribir un test de caja que pasa midiendo nada.
 */
const CASH_AND_PAY_GRANTS = {
  ...CASH_GRANTS,
  payments: { view: true, create: true, erase: true },
  reservation_management: { view: true, create: true, update: true, erase: true },
}

/** Guarda una configuración de turnos. */
async function setShifts(shifts: CashShift[]) {
  await Setting.updateOrCreate(
    { key: CASH_SHIFTS_KEY },
    { key: CASH_SHIFTS_KEY, value: JSON.stringify(shifts) }
  )
}

function minuteNow(): number {
  const now = nowART()
  return now.hour * 60 + now.minute
}

/** Un turno que CONTIENE el instante actual. */
function shiftAroundNow(name = 'Turno En Curso'): CashShift {
  const m = minuteNow()
  return {
    name,
    startMinute: Math.max(0, m - 30),
    endMinute: Math.min(1440, Math.max(1, m + 30)),
  }
}

/**
 * Un turno que NO contiene el instante actual — reproduce la madrugada: el reloj cae
 * en un hueco de la configuración, así que no hay ningún turno en curso.
 */
function shiftAwayFromNow(name = 'Turno Lejano'): CashShift {
  const m = minuteNow()
  return m < 720
    ? { name, startMinute: 1380, endMinute: 1440 }
    : { name, startMinute: 0, endMinute: 60 }
}

/** Abre una sesión con un snapshot de turno explícito, sin pasar por el endpoint. */
async function openSessionWith(
  user: User,
  opts: { shiftName: string; businessDate?: string; startMinute?: number; endMinute?: number }
): Promise<CashSession> {
  const now = nowART()
  return CashSession.create({
    shiftName: opts.shiftName,
    shiftStartMinute: opts.startMinute ?? 480,
    shiftEndMinute: opts.endMinute ?? 960,
    businessDate: opts.businessDate ?? now.toISODate()!,
    openedAt: now,
    openedBy: user.id,
    expectedCloseAt: now.plus({ hours: 1 }),
    openingEfectivo: 0,
    openMarker: 1,
  })
}

async function payCourt(client: any, staff: User, amount = 2000) {
  const court = await createPadelCourt(amount)
  const customer = await createCustomer()
  const reservation = await createRecurringReservation(court, customer)
  return client
    .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
    .loginAs(staff)
    .json({ efectivo: amount })
}

// ─────────────────────────────────────────────────────────────────────────────

test.group('caja — apertura y unicidad', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja arranca CERRADA, independiente de lo que el complejo tenga abierto en la
  // app. Va DESPUÉS de la transacción para revertirse con ella. Ver closeAmbientCashRegister.
  group.each.setup(async () => {
    await closeAmbientCashRegister()
  })

  /**
   * EL CONTRATO DEL FIXTURE, escrito como test.
   *
   * El UNIQUE sobre `open_marker` es una restricción GLOBAL: ve las filas commiteadas
   * afuera de la transacción del test. Cuando la suite corría contra la base de dev,
   * bastaba con que el complejo dejara la caja abierta en la app para que este spec
   * entero se cayera con `Duplicate entry '1'` — pasó, y fueron ~100 tests. La base
   * aislada saca esa causa de encima, pero el fixture sigue siendo el que FIJA la
   * precondición en vez de heredarla, y eso es lo que este test verifica.
   *
   * Este test afirma la precondición directamente: si alguien saca la neutralización del
   * setup o le cambia la semántica, se pone rojo acá y no en cascada por todos lados.
   */
  test('el fixture deja la caja cerrada, sin importar lo que el complejo tenga abierto', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    current.assertStatus(200)
    assert.equal(current.body().reason, 'closed')
    assert.isNull(current.body().session)
  })

  test('abre la caja en el turno que resuelve el reloj', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow('Mañana')])

    const response = await client
      .post('/api/v1/cash-register/open')
      .loginAs(staff)
      .json({ openingEfectivo: 5000 })
    response.assertStatus(201)

    const body = response.body()
    assert.equal(body.session.shiftName, 'Mañana')
    assert.equal(Number(body.session.openingEfectivo), 5000)
    assert.equal(body.session.openMarker, 1)
    assert.isNull(body.session.closedAt)
  })

  test('abrir dos veces devuelve 409', async ({ client }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow()])

    const first = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    first.assertStatus(201)

    const second = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    second.assertStatus(409)
    second.assertBodyContains({ code: 'CASH_REGISTER_ALREADY_OPEN' })
  })

  /**
   * El invariante "nunca hay más de una sesión abierta" NO lo sostiene el `if` del
   * controller — lo sostiene el índice UNIQUE sobre `open_marker`. Un chequeo en el
   * controller pierde contra dos requests concurrentes; este test prueba que la base
   * de datos rechaza la segunda sesión abierta incluso salteando el endpoint.
   *
   * De ese invariante depende que los movimientos de un turno se puedan derivar por
   * ventana de tiempo en lugar de guardar un cash_session_id en las tres tablas de plata.
   */
  test('la base de datos rechaza una segunda sesión abierta', async ({ assert }) => {
    const staff = await createStaff()
    await openSessionWith(staff, { shiftName: 'Primera' })

    let failed = false
    try {
      await openSessionWith(staff, { shiftName: 'Segunda' })
    } catch {
      failed = true
    }
    assert.isTrue(failed, 'el UNIQUE sobre open_marker debe rechazar la segunda sesión abierta')
  })

  test('la sesión cerrada libera el UNIQUE para la siguiente', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])

    const first = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    first.assertStatus(201)
    await payCourt(client, staff, 3000)

    const closed = await client
      .post('/api/v1/cash-register/close')
      .loginAs(staff)
      .json({ sessionId: first.body().session.id })
    closed.assertStatus(200)
    assert.isNull(closed.body().session.openMarker)

    const second = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    second.assertStatus(201)
  })
})

test.group('caja — el bloqueo de movimientos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja arranca CERRADA, independiente de lo que el complejo tenga abierto en la
  // app. Va DESPUÉS de la transacción para revertirse con ella. Ver closeAmbientCashRegister.
  group.each.setup(async () => {
    await closeAmbientCashRegister()
  })

  test('con la caja cerrada, cobrar una cancha devuelve 409 CASH_REGISTER_CLOSED', async ({
    client,
  }) => {
    const staff = await createStaff()
    await setShifts([shiftAroundNow('Tarde')])

    const response = await payCourt(client, staff)
    response.assertStatus(409)
    response.assertBodyContains({ code: 'CASH_REGISTER_CLOSED' })
  })

  test('con la caja cerrada, vender en el kiosco devuelve 409', async ({ client }) => {
    const staff = await createStaff()
    const product = await createProduct({ price: 1000 })

    const response = await client
      .post('/api/v1/sales')
      .loginAs(staff)
      .json({ items: [{ productId: product.id, quantity: 1 }], efectivo: 1000 })
    response.assertStatus(409)
    response.assertBodyContains({ code: 'CASH_REGISTER_CLOSED' })
  })

  test('con la caja cerrada, cargar un gasto devuelve 409', async ({ client }) => {
    const staff = await createUserWithPermissions({ expenses: { create: true } })
    const category = await createExpenseCategory()

    const response = await client.post('/api/v1/expenses').loginAs(staff).json({
      categoryId: category.id,
      description: 'Papel higiénico',
      amount: 2000,
      expenseDate: nowART().toISODate(),
    })
    response.assertStatus(409)
    response.assertBodyContains({ code: 'CASH_REGISTER_CLOSED' })
  })

  test('con la caja abierta en su propio turno, el cobro pasa', async ({ client }) => {
    const staff = await createStaff()
    await setShifts([shiftAroundNow('Tarde')])
    await openSessionWith(staff, {
      shiftName: 'Tarde',
      startMinute: shiftAroundNow().startMinute,
      endMinute: shiftAroundNow().endMinute,
    })

    const response = await payCourt(client, staff)
    response.assertStatus(200)
  })

  /**
   * ESTE ES EL TEST QUE FIJA LA REGLA.
   *
   * Con la caja abierta y NINGÚN turno en curso (la madrugada), el cobro PASA: entra en
   * la sesión que quedó abierta. El turno está vencido hace horas — `expected_close_at`
   * ya pasó — y eso NO alcanza para pedir una rotación.
   *
   * Si alguien vuelve a atar el disparador a `now > expected_close_at`, este test se
   * pone rojo. Es lo único que impide que la app pida cerrar y abrir la caja a las 2 de
   * la mañana, y otra vez a las 3, y a las 4, en medio del servicio.
   */
  test('sin turno en curso (madrugada), el cobro entra en la sesión abierta y vencida', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const away = shiftAwayFromNow('Tarde')
    await setShifts([away])

    const session = await openSessionWith(staff, {
      shiftName: 'Tarde',
      startMinute: away.startMinute,
      endMinute: away.endMinute,
    })
    // El turno ya debería haber cerrado: vencido a propósito.
    session.expectedCloseAt = nowART().minus({ hours: 2 })
    await session.save()

    const response = await payCourt(client, staff)
    response.assertStatus(200)
    assert.isTrue(true)
  })

  test('con OTRO turno en curso, el cobro devuelve 409 CASH_SHIFT_CHANGED', async ({ client }) => {
    const staff = await createStaff()
    await setShifts([shiftAroundNow('Tarde')])
    // La sesión abierta dice "Mañana"; el reloj dice que corre "Tarde".
    await openSessionWith(staff, { shiftName: 'Mañana' })

    const response = await payCourt(client, staff)
    response.assertStatus(409)
    response.assertBodyContains({ code: 'CASH_SHIFT_CHANGED' })
  })

  /**
   * Mismo NOMBRE de turno, distinta fecha: alguien se olvidó de cerrar el Tarde de ayer
   * y hoy vuelve a correr Tarde. Hay que rotar igual — 24 horas de movimientos en una
   * sola sesión no son un turno. Por eso la comparación va sobre (turno, fecha) y no
   * solo sobre el nombre.
   */
  test('mismo turno pero de ayer también exige rotar', async ({ client }) => {
    const staff = await createStaff()
    const around = shiftAroundNow('Tarde')
    await setShifts([around])
    await openSessionWith(staff, {
      shiftName: 'Tarde',
      businessDate: nowART().minus({ days: 1 }).toISODate()!,
      startMinute: around.startMinute,
      endMinute: around.endMinute,
    })

    const response = await payCourt(client, staff)
    response.assertStatus(409)
    response.assertBodyContains({ code: 'CASH_SHIFT_CHANGED' })
  })

  /**
   * La reserva de un cliente desde el celular NO toca plata y NO se gatea. Un cliente
   * reservando de madrugada no puede depender de que la caja del mostrador esté abierta.
   */
  test('la reserva de invitado funciona con la caja cerrada', async ({ client, assert }) => {
    const court = await createPadelCourt(2000)
    const startTime = nowART().plus({ days: 3 }).set({ hour: 10, minute: 0 }).toISO()

    const response = await client.post('/api/v1/guest/reservations').json({
      fullName: 'Cliente Nocturno',
      phone: `11${Date.now()}`.slice(0, 12),
      courtId: court.id,
      startTime,
      duration: 60,
    })

    assert.notEqual(response.status(), 409, 'la reserva de invitado no debe depender de la caja')
  })
})

test.group('caja — rotación', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja arranca CERRADA, independiente de lo que el complejo tenga abierto en la
  // app. Va DESPUÉS de la transacción para revertirse con ella. Ver closeAmbientCashRegister.
  group.each.setup(async () => {
    await closeAmbientCashRegister()
  })

  test('rotate cierra el turno vencido y abre el que corre, en una sola llamada', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    const around = shiftAroundNow('Tarde')
    await setShifts([around])
    const old = await openSessionWith(staff, { shiftName: 'Mañana' })

    const paid = await client
      .post('/api/v1/cash-register/rotate')
      .loginAs(staff)
      .json({ sessionId: old.id })
    paid.assertStatus(200)

    const body = paid.body()
    assert.equal(body.closed.shiftName, 'Mañana')
    assert.isNotNull(body.closed.closedAt)
    assert.isNull(body.closed.openMarker)
    assert.equal(body.session.shiftName, 'Tarde')
    assert.isNull(body.session.closedAt)

    // Y queda exactamente una abierta: el invariante se mantiene a través de la rotación.
    const open = await CashSession.query().whereNull('closed_at')
    assert.lengthOf(open, 1)
  })

  test('rotate con un sessionId viejo devuelve 409 en lugar de rotar la sesión equivocada', async ({
    client,
  }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow('Tarde')])
    await openSessionWith(staff, { shiftName: 'Mañana' })

    const response = await client
      .post('/api/v1/cash-register/rotate')
      .loginAs(staff)
      .json({ sessionId: 999999 })
    response.assertStatus(409)
    response.assertBodyContains({ code: 'CASH_SESSION_STALE' })
  })
})

test.group('caja — arqueo y movimientos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja arranca CERRADA, independiente de lo que el complejo tenga abierto en la
  // app. Va DESPUÉS de la transacción para revertirse con ella. Ver closeAmbientCashRegister.
  group.each.setup(async () => {
    await closeAmbientCashRegister()
  })

  test('el turno suma cobros de cancha y ventas, y resta gastos', async ({ client, assert }) => {
    const staff = await createUserWithPermissions({
      ...CASH_GRANTS,
      expenses: { view: true, create: true },
      payments: { view: true, create: true },
      reservation_management: { view: true, create: true, update: true },
      sales: { view: true, create: true },
      products: { view: true, update: true },
    })
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({ openingEfectivo: 10000 })

    await payCourt(client, staff, 12000)

    const product = await createProduct({ price: 3500 })
    const sale = await client
      .post('/api/v1/sales')
      .loginAs(staff)
      .json({ items: [{ productId: product.id, quantity: 1 }], postnet: 3500 })
    sale.assertStatus(201)

    const category = await createExpenseCategory()
    const expense = await client.post('/api/v1/expenses').loginAs(staff).json({
      categoryId: category.id,
      description: 'Papel',
      amount: 2000,
      efectivo: 2000,
      expenseDate: nowART().toISODate(),
    })
    expense.assertStatus(201)

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    current.assertStatus(200)
    const { totals, movements } = current.body()

    assert.equal(totals.in.efectivo, 12000)
    assert.equal(totals.in.postnet, 3500)
    assert.equal(totals.out.efectivo, 2000)
    assert.equal(totals.net.efectivo, 10000)
    // 10.000 de fondo + 12.000 cobrados − 2.000 pagados
    assert.equal(totals.expectedEfectivo, 20000)
    assert.equal(totals.count, 3)
    assert.lengthOf(movements, 3)
  })

  /**
   * `expense_date` es el día del comprobante; `created_at` es cuándo salió la plata del
   * cajón. El turno se arma con `created_at`. Un gasto fechado ayer y cargado hoy sale
   * del cajón HOY, así que va en el turno de hoy.
   *
   * Si alguien cambia el servicio para filtrar por `expense_date`, este test se pone rojo.
   */
  test('un gasto fechado ayer pero cargado hoy cae en el turno de hoy', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions({
      ...CASH_GRANTS,
      expenses: { view: true, create: true },
    })
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    const category = await createExpenseCategory()
    const expense = await client
      .post('/api/v1/expenses')
      .loginAs(staff)
      .json({
        categoryId: category.id,
        description: 'Factura de luz de ayer',
        amount: 5000,
        efectivo: 5000,
        expenseDate: nowART().minus({ days: 1 }).toISODate(),
      })
    expense.assertStatus(201)

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    assert.equal(current.body().totals.out.efectivo, 5000)
    assert.equal(current.body().totals.count, 1)
  })

  /**
   * El worker cierra la caja pero no tiene `expenses.view`. La salida de efectivo tiene
   * que aparecer o el conteo del cajón no cierra nunca; el detalle del gasto no, porque
   * su permiso se lo niega. El monto sin el detalle es la única respuesta que cumple
   * las dos cosas.
   */
  test('sin expenses.view, el gasto aparece con monto pero sin descripción', async ({
    client,
    assert,
  }) => {
    const cashier = await createUserWithPermissions({ expenses: { create: true } })
    await setShifts([shiftAroundNow()])
    await openSessionWith(cashier, {
      shiftName: shiftAroundNow().name,
      startMinute: shiftAroundNow().startMinute,
      endMinute: shiftAroundNow().endMinute,
    })

    const category = await createExpenseCategory()
    const created = await client.post('/api/v1/expenses').loginAs(cashier).json({
      categoryId: category.id,
      description: 'Pintura de la cancha 3',
      amount: 7000,
      efectivo: 7000,
      expenseDate: nowART().toISODate(),
    })
    created.assertStatus(201)

    const blind = await createUserWithPermissions(CASH_GRANTS)
    const current = await client.get('/api/v1/cash-register/current').loginAs(blind)
    current.assertStatus(200)

    const movement = current.body().movements.find((m: any) => m.kind === 'expense')
    assert.isDefined(movement)
    assert.equal(movement!.total, 7000)
    assert.equal(movement!.label, 'Salida de caja')
    assert.isNull(movement!.reference)
    assert.notInclude(JSON.stringify(current.body()), 'Pintura de la cancha 3')
  })

  test('con expenses.view el gasto muestra su descripción', async ({ client, assert }) => {
    const staff = await createUserWithPermissions({
      ...CASH_GRANTS,
      expenses: { view: true, create: true },
    })
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    const category = await createExpenseCategory()
    await client.post('/api/v1/expenses').loginAs(staff).json({
      categoryId: category.id,
      description: 'Pintura de la cancha 3',
      amount: 7000,
      efectivo: 7000,
      expenseDate: nowART().toISODate(),
    })

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    const movement = current.body().movements.find((m: any) => m.kind === 'expense')
    assert.isDefined(movement)
    assert.include(movement!.label, 'Pintura de la cancha 3')
  })

  test('cerrar congela los totales y el turno siguiente arranca vacío', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])
    const opened = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    await payCourt(client, staff, 8000)

    const closed = await client
      .post('/api/v1/cash-register/close')
      .loginAs(staff)
      .json({ sessionId: opened.body().session.id, countedEfectivo: 7500, notes: 'faltaron 500' })
    closed.assertStatus(200)

    const session = closed.body().session
    assert.equal(Number(session.inEfectivo), 8000)
    assert.equal(Number(session.countedEfectivo), 7500)
    assert.equal(session.movementsCount, 1)
    assert.equal(session.notes, 'faltaron 500')

    const reopened = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    reopened.assertStatus(201)
    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    assert.equal(current.body().totals.count, 0, 'el turno nuevo arranca sin movimientos')
  })

  test('un pago revertido aparece como salida del turno', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    const court = await createPadelCourt(4000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    const pay = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 4000 })
    pay.assertStatus(200)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .firstOrFail()

    const revert = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)
    revert.assertStatus(200)

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    const { totals, movements } = current.body()

    // Cobrado y revertido en el mismo turno: los dos hechos quedan visibles y netean cero.
    assert.equal(totals.in.efectivo, 4000)
    assert.equal(totals.out.efectivo, 4000)
    assert.equal(totals.net.efectivo, 0)
    assert.lengthOf(movements, 2)
    assert.isTrue(movements.some((m: any) => m.kind === 'payment_reverted'))
  })

  /**
   * EL CASO QUE JUSTIFICA TODA LA FASE 0 Y LAS DOS COLUMNAS DE SESIÓN.
   *
   * Un cobro entra en el turno A. Se cierra A. En el turno B alguien revierte ese cobro:
   * la plata sale del cajón AHORA, en B, no retroactivamente en A. Entonces:
   *   - el arqueo de A sigue diciendo que entraron $5.000 (fue verdad, y ya está cerrado);
   *   - el turno B muestra una salida de $5.000.
   *
   * Con el DELETE físico original la fila desaparecía y B no tenía nada que restar: el
   * efectivo esperado de B quedaba $5.000 inflado y la caja se descuadraba en silencio.
   * Y con una sola columna de sesión, la devolución le habría robado el ingreso a A.
   */
  test('un cobro revertido en el turno SIGUIENTE sale de ese turno, no del original', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])

    // ── Turno A: se cobra ──
    const turnoA = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    turnoA.assertStatus(201)

    const court = await createPadelCourt(5000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    const pay = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 5000 })
    pay.assertStatus(200)

    const sessionAId = turnoA.body().session.id
    const closedA = await client
      .post('/api/v1/cash-register/close')
      .loginAs(staff)
      .json({ sessionId: sessionAId })
    closedA.assertStatus(200)
    assert.equal(Number(closedA.body().session.inEfectivo), 5000)

    // ── Turno B: se revierte ──
    const turnoB = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    turnoB.assertStatus(201)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .firstOrFail()
    const revert = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)
    revert.assertStatus(200)

    // B muestra la salida.
    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    const bTotals = current.body().totals
    assert.equal(bTotals.out.efectivo, 5000, 'la devolución sale del turno B')
    assert.equal(bTotals.in.efectivo, 0, 'B no cobró nada')
    assert.equal(bTotals.expectedEfectivo, -5000, 'B sacó plata del cajón que no puso')

    // Y A sigue diciendo lo que dijo: fue verdad y ya está cerrado.
    const detailA = await client.get(`/api/v1/cash-register/sessions/${sessionAId}`).loginAs(staff)
    assert.equal(detailA.body().totals.in.efectivo, 5000)
    assert.equal(detailA.body().totals.out.efectivo, 0, 'la devolución NO le vuelve a A')
    assert.lengthOf(detailA.body().movements, 1)
  })

  test('el historial trae el cierre con sus movimientos y su método de pago', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])
    const opened = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    await payCourt(client, staff, 6000)

    const sessionId = opened.body().session.id
    await client.post('/api/v1/cash-register/close').loginAs(staff).json({ sessionId })

    const detail = await client.get(`/api/v1/cash-register/sessions/${sessionId}`).loginAs(staff)
    detail.assertStatus(200)
    const body = detail.body()
    assert.lengthOf(body.movements, 1)
    assert.equal(body.movements[0].efectivo, 6000)
    assert.equal(body.movements[0].kind, 'court_payment')
    assert.equal(body.totals.in.efectivo, 6000)
  })
})

/**
 * Los FAJOS: efectivo retirado del cajón durante el turno.
 *
 * Lo que estos tests protegen es una sola idea, y es la que hace distinto al fajo de
 * todos los demás movimientos: baja el cajón SIN ser una salida de plata del complejo.
 * Por eso cada test que mira `expectedEfectivo` mira también `net`, y viceversa — el
 * error que se quiere atrapar es justamente el de mezclarlos.
 */
test.group('caja — fajos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja arranca CERRADA, independiente de lo que el complejo tenga abierto en la
  // app. Va DESPUÉS de la transacción para revertirse con ella. Ver closeAmbientCashRegister.
  group.each.setup(async () => {
    await closeAmbientCashRegister()
  })

  test('un fajo baja el efectivo esperado y no toca lo que el turno facturó', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({ openingEfectivo: 5000 })
    await payCourt(client, staff, 100000)

    const created = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(staff)
      .json({ amount: 80000, notes: 'primer retiro' })
    created.assertStatus(201)

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    const body = current.body()

    assert.equal(body.totals.bundlesEfectivo, 80000)
    assert.equal(body.totals.out.efectivo, 0, 'un fajo no es una salida de plata')
    assert.equal(body.totals.net.total, 100000, 'el turno facturó 100.000')
    // 5.000 de fondo + 100.000 cobrados − 80.000 retirados
    assert.equal(body.totals.expectedEfectivo, 25000)

    const bundle = body.movements.find((m: any) => m.kind === 'cash_bundle') as any
    assert.exists(bundle, 'el fajo se muestra entre los movimientos del turno')
    assert.equal(bundle.direction, 'out')
    assert.equal(bundle.total, 80000)
    assert.include(bundle.label, 'primer retiro')
  })

  test('varios fajos en el mismo turno se acumulan', async ({ client, assert }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    for (const amount of [30000, 45000, 12500]) {
      const res = await client.post('/api/v1/cash-register/bundles').loginAs(staff).json({ amount })
      res.assertStatus(201)
    }

    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    assert.equal(current.body().totals.bundlesEfectivo, 87500)
    assert.equal(current.body().totals.count, 3)
  })

  test('un fajo de monto cero se rechaza', async ({ client }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    const res = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(staff)
      .json({ amount: 0 })
    res.assertStatus(422)
  })

  test('con la caja cerrada, cargar un fajo devuelve 409 CASH_REGISTER_CLOSED', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    const res = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(staff)
      .json({ amount: 1000 })
    res.assertStatus(409)
    assert.equal((res.body() as any).code, 'CASH_REGISTER_CLOSED')
  })

  test('anular un fajo en el mismo turno devuelve el efectivo y deja los dos hechos', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    await payCourt(client, staff, 50000)

    const created = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(staff)
      .json({ amount: 40000 })
    const bundleId = created.body().bundle.id

    const cancelled = await client
      .post(`/api/v1/cash-register/bundles/${bundleId}/cancel`)
      .loginAs(staff)
      .json({})
    cancelled.assertStatus(200)

    const after = await client.get('/api/v1/cash-register/current').loginAs(staff)
    const body = after.body()
    assert.equal(body.totals.bundlesEfectivo, 0)
    assert.equal(body.totals.expectedEfectivo, 50000, 'el efectivo volvió al cajón')
    assert.equal(body.totals.in.efectivo, 50000, 'la anulación tampoco es un ingreso')
    assert.equal(body.totals.count, 3, 'el cobro, el fajo y su anulación quedan visibles')
  })

  test('anular dos veces el mismo fajo se rechaza', async ({ client }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow()])
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    const created = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(staff)
      .json({ amount: 1000 })
    const bundleId = created.body().bundle.id

    await client.post(`/api/v1/cash-register/bundles/${bundleId}/cancel`).loginAs(staff).json({})
    const again = await client
      .post(`/api/v1/cash-register/bundles/${bundleId}/cancel`)
      .loginAs(staff)
      .json({})
    again.assertStatus(400)
  })

  /**
   * El caso que justifica la columna `cancelled_in_cash_session_id`: la plata vuelve al
   * cajón del turno en que se anuló, no al que la retiró. Si volviera al original, el
   * turno ya cerrado cambiaría su arqueo después de cerrado.
   */
  test('un fajo anulado en el turno siguiente devuelve el efectivo a ESE turno', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow()])
    const opened = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    const firstId = opened.body().session.id

    const created = await client
      .post('/api/v1/cash-register/bundles')
      .loginAs(staff)
      .json({ amount: 20000 })
    const bundleId = created.body().bundle.id

    await client.post('/api/v1/cash-register/close').loginAs(staff).json({ sessionId: firstId })
    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})

    await client.post(`/api/v1/cash-register/bundles/${bundleId}/cancel`).loginAs(staff).json({})

    const currentRes = await client.get('/api/v1/cash-register/current').loginAs(staff)
    const current = currentRes.body()
    assert.equal(current.totals.bundlesEfectivo, -20000, 'el efectivo entra al turno nuevo')
    assert.equal(current.totals.expectedEfectivo, 20000)

    const pastRes = await client.get(`/api/v1/cash-register/sessions/${firstId}`).loginAs(staff)
    assert.equal(pastRes.body().totals.bundlesEfectivo, 20000, 'el turno cerrado no cambia')
  })

  test('cerrar congela los fajos y el turno siguiente arranca en cero', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_AND_PAY_GRANTS)
    await setShifts([shiftAroundNow()])
    const opened = await client
      .post('/api/v1/cash-register/open')
      .loginAs(staff)
      .json({ openingEfectivo: 2000 })
    await payCourt(client, staff, 30000)
    await client.post('/api/v1/cash-register/bundles').loginAs(staff).json({ amount: 25000 })

    const closed = await client
      .post('/api/v1/cash-register/close')
      .loginAs(staff)
      .json({ sessionId: opened.body().session.id, countedEfectivo: 7000 })
    closed.assertStatus(200)

    const session = closed.body().session
    assert.equal(Number(session.bundlesEfectivo), 25000)
    assert.equal(Number(session.outEfectivo), 0, 'el fajo no se congela como salida')
    assert.equal(Number(session.inEfectivo), 30000)
    // La cuenta que hace el historial con las columnas congeladas:
    // 2.000 de fondo + 30.000 − 0 − 25.000 = 7.000, que es lo que contaron.
    const expected =
      Number(session.openingEfectivo) +
      (Number(session.inEfectivo) - Number(session.outEfectivo)) -
      Number(session.bundlesEfectivo)
    assert.equal(expected, 7000)

    await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    const current = await client.get('/api/v1/cash-register/current').loginAs(staff)
    assert.equal(current.body().totals.bundlesEfectivo, 0)
  })

  test('el detalle del cierre recalcula el mismo total de fajos que se congeló', async ({
    client,
    assert,
  }) => {
    const staff = await createUserWithPermissions(CASH_GRANTS)
    await setShifts([shiftAroundNow()])
    const opened = await client.post('/api/v1/cash-register/open').loginAs(staff).json({})
    const sessionId = opened.body().session.id
    await client.post('/api/v1/cash-register/bundles').loginAs(staff).json({ amount: 15000 })
    await client.post('/api/v1/cash-register/close').loginAs(staff).json({ sessionId })

    const detail = await client.get(`/api/v1/cash-register/sessions/${sessionId}`).loginAs(staff)
    detail.assertStatus(200)
    assert.equal(detail.body().totals.bundlesEfectivo, 15000)
    assert.equal(Number(detail.body().session.bundlesEfectivo), 15000)
  })
})
