import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ReservationAuditLog from '#models/reservation_audit_log'
import ReservationPayment from '#models/reservation_payment'
import {
  closeAmbientCashRegister,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  createStaff,
  createUserWithPermissions,
  openCashSession,
  todayISODate,
  weeksAgoISODate,
} from './fixtures.js'

/**
 * `settleDebt` cobra el saldo arrastrado de una fija sin cobrar ningún turno.
 *
 * Lo que estos tests protegen, y que es todo el punto del endpoint:
 *   - el saldo se mueve (la deuda baja o se convierte en crédito),
 *   - NINGUNA ocurrencia queda marcada como paga por haber cobrado una deuda,
 *   - la plata queda imputada a HOY: `cash_session_id` = la caja abierta y
 *     `occurrence_date` = la fecha de hoy en ART.
 *
 * Los permisos van por `createUserWithPermissions`, nunca por nombre de rol.
 */

// Deja la serie debiendo `debt` pesos: cobra una ocurrencia pasada de menos, y el precio
// congelado en `expected_amount` es lo que genera el saldo negativo.
async function giveSeriesDebt(reservationId: number, price: number, paid: number) {
  await ReservationPayment.create({
    reservationId,
    type: 'total',
    efectivo: paid,
    transferencia: 0,
    postnet: 0,
    total: paid,
    paidBy: 1,
    occurrenceDate: weeksAgoISODate(1),
    expectedAmount: price,
  })
}

test.group('settleDebt — mueve el saldo de la serie', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await openCashSession()
  })

  test('cobro parcial baja la deuda sin saldarla', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1000 })

    res.assertStatus(200)
    assert.equal(Number(res.body().carryBalance), -2000)
  })

  test('cobro exacto deja el saldo en cero', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 2000, transferencia: 1000 })

    res.assertStatus(200)
    assert.equal(Number(res.body().carryBalance), 0)
  })

  test('cobrar de más convierte el resto en crédito', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 4000 })

    res.assertStatus(200)
    assert.equal(Number(res.body().carryBalance), 1000)
  })

  test('el saldo se recalcula en el servidor, no se toma del cliente', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    // Debe 1000, no 3000: pagó 2000 de un turno de 3000.
    await giveSeriesDebt(reservation.id, 3000, 2000)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1000, carryBalance: -99999, debt: 99999 })

    res.assertStatus(200)
    assert.equal(Number(res.body().carryBalance), 0)
  })

  test('el split por método se guarda tal cual', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 500, transferencia: 300, postnet: 200 })

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'debt')
      .firstOrFail()
    assert.equal(Number(payment.efectivo), 500)
    assert.equal(Number(payment.transferencia), 300)
    assert.equal(Number(payment.postnet), 200)
    assert.equal(Number(payment.total), 1000)
  })
})

test.group('settleDebt — rechazos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await openCashSession()
  })

  test('sin deuda → 400', async ({ client }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1000 })

    res.assertStatus(400)
    res.assertBodyContains({ message: 'Esta reserva no tiene deuda' })
  })

  test('con crédito a favor → 400', async ({ client }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 5000) // pagó de más: crédito

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1000 })

    res.assertStatus(400)
  })

  test('reserva no recurrente → 400', async ({ client }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    reservation.isRecurring = false
    await reservation.save()

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1000 })

    res.assertStatus(400)
    res.assertBodyContains({ message: 'Solo las reservas fijas acumulan deuda' })
  })

  test('reserva cancelada → 400', async ({ client }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)
    reservation.status = 'cancelled'
    await reservation.save()

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1000 })

    res.assertStatus(400)
  })

  test('monto $0 → 400 y ninguna fila creada', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 0 })

    res.assertStatus(400)
    res.assertBodyContains({ message: 'El monto debe ser mayor a $0' })
    const rows = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'debt')
    assert.lengthOf(rows, 0)
  })
})

test.group('settleDebt — no toca el estado de pago de ninguna ocurrencia', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await openCashSession()
  })

  test('la ocurrencia de hoy sigue impaga y cobrable después de saldar la deuda', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 3000 })

    // El pago de deuda lleva `occurrence_date` = hoy, así que si se hubiera guardado como
    // type='total' esta ocurrencia figuraría paga y el cobro de abajo daría 400.
    const show = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(staff)
    show.assertStatus(200)
    assert.notInclude(show.body().paidOccurrences ?? [], todayISODate())
    assert.isFalse(show.body().totalPaid)

    const pay = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    pay.assertStatus(200)
  })

  test('no mueve la racha ni el contador de pagos totales', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, { consecutiveGames: 2 })
    await giveSeriesDebt(reservation.id, 3000, 0)
    const countBefore = reservation.totalPaidCount ?? 0

    await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 3000 })

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 2)
    assert.equal(reservation.totalPaidCount ?? 0, countBefore)
    assert.isFalse(reservation.totalPaid)
  })
})

test.group('settleDebt — imputación al día de hoy y a la caja abierta', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('estampa la sesión de caja abierta y la fecha de hoy en ART', async ({ client, assert }) => {
    const session = await openCashSession()
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 3000 })

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'debt')
      .firstOrFail()
    assert.equal(payment.cashSessionId, session.id)
    assert.equal(payment.occurrenceDate, todayISODate())
    assert.equal(Number(payment.expectedAmount), 0)
  })

  test('caja cerrada → 409 y ninguna fila creada', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)
    await closeAmbientCashRegister()

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 3000 })

    res.assertStatus(409)
    res.assertBodyContains({ code: 'CASH_REGISTER_CLOSED' })
    const rows = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'debt')
    assert.lengthOf(rows, 0)
  })
})

test.group('settleDebt — auditoría y reversión', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await openCashSession()
  })

  test('queda auditado con el campo debtPayment', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(staff)
      .json({ efectivo: 1200 })

    const log = await ReservationAuditLog.query()
      .where('reservation_id', reservation.id)
      .where('field', 'debtPayment')
      .firstOrFail()
    assert.equal(log.performedBy, staff.id)
    assert.include(log.newValue!, '1200')
    assert.include(log.newValue!, todayISODate())
    assert.include(log.oldValue!, '3000')
  })

  test('revertir el cobro devuelve la deuda y no descuenta el contador de pagos', async ({
    client,
    assert,
  }) => {
    const admin = await createUserWithPermissions({
      reservations: { view: true, create: true, update: true, erase: true },
      reservation_management: { view: true, create: true, update: true, erase: true },
      payments: { view: true, create: true, update: true, erase: true },
    })
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const settle = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(admin)
      .json({ efectivo: 3000 })
    settle.assertStatus(200)
    assert.equal(Number(settle.body().carryBalance), 0)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .where('type', 'debt')
      .firstOrFail()
    await reservation.refresh()
    const countBefore = reservation.totalPaidCount ?? 0

    const revert = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(admin)
    revert.assertStatus(200)

    const show = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(admin)
    assert.equal(Number(show.body().carryBalance), -3000)
    await reservation.refresh()
    assert.equal(reservation.totalPaidCount ?? 0, countBefore)
  })
})

test.group('settleDebt — permisos', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await openCashSession()
  })

  test('sin payments.create → 403', async ({ client }) => {
    const nobody = await createUserWithPermissions({ reservations: { view: true } })
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(nobody)
      .json({ efectivo: 1000 })

    res.assertStatus(403)
  })

  test('con payments.create pasa el guard de permisos', async ({ client, assert }) => {
    const granted = await createUserWithPermissions({ payments: { create: true } })
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)
    await giveSeriesDebt(reservation.id, 3000, 0)

    const res = await client
      .patch(`/api/v1/reservations/${reservation.id}/settle-debt`)
      .loginAs(granted)
      .json({ efectivo: 1000 })

    assert.notEqual(res.status(), 403)
  })
})
