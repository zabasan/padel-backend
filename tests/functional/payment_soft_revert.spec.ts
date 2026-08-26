import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ReservationPayment from '#models/reservation_payment'
import {
  createStaff,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  openCashSession,
} from './fixtures.js'

/**
 * Revertir un pago lo ANULA, no lo borra.
 *
 * Hasta la migración 1784000000001 `revertPayment` hacía un DELETE físico, y
 * `reservation_payments` era la única tabla de plata que se borraba. El caso que
 * eso rompía: un pago cobrado en un turno y revertido en OTRO. La plata sale del
 * cajón en el segundo turno, pero sin fila no quedaba nada que lo dijera, así que
 * el cierre de caja de ese turno contaba efectivo que ya no estaba.
 *
 * Estos tests fijan las dos mitades del invariante: la fila SOBREVIVE con su
 * `reverted_at`, y toda lectura de pagos vigentes la ignora.
 *
 * El grupo entero corre dentro de una transacción global revertida, así que nada de
 * lo que escribe sobrevive al test.
 */
test.group('revertPayment — anula, no borra', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // La caja tiene que estar abierta: middleware.cashRegister bloquea todo movimiento
  // de plata con 409 si no lo está. Va DESPUÉS de la transacción para revertirse con ella.
  group.each.setup(async () => {
    await openCashSession()
  })

  test('la fila sobrevive con reverted_at y reverted_by', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    const pay = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    pay.assertStatus(200)

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .firstOrFail()
    assert.isNull(payment.revertedAt)

    const revert = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)
    revert.assertStatus(200)

    // La fila sigue ahí: es el único registro de que la plata salió del cajón.
    const after = await ReservationPayment.find(payment.id)
    assert.isNotNull(after, 'el pago revertido no debe borrarse')
    assert.isNotNull(after!.revertedAt)
    assert.equal(after!.revertedBy, staff.id)
    // Y conserva el desglose por método, que es lo que el cierre de caja necesita restar.
    assert.equal(Number(after!.efectivo), 2000)
  })

  test('un pago anulado no cuenta como vigente: la ocurrencia se puede volver a cobrar', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .firstOrFail()

    // Sin revertir, recobrar la misma ocurrencia se rechaza.
    const blocked = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    blocked.assertStatus(400)

    await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)

    // Revertido, la ocurrencia volvió a estar impaga: el guard de "ya fue registrado"
    // filtra por reverted_at IS NULL. Si no lo hiciera, un cobro revertido por error
    // dejaría la ocurrencia impagable para siempre.
    const again = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    again.assertStatus(200)

    const live = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .whereNull('reverted_at')
    assert.lengthOf(live, 1, 'debe quedar exactamente un pago vigente')
  })

  test('revertir dos veces el mismo pago se rechaza', async ({ client }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .firstOrFail()

    const first = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)
    first.assertStatus(200)

    // Doble reversión descontaría totalPaidCount dos veces por un solo pago, y le
    // cargaría al turno actual una salida de plata que ya salió.
    const second = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)
    second.assertStatus(400)
  })

  test('la reserva no expone los pagos anulados en payments', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })

    const payment = await ReservationPayment.query()
      .where('reservation_id', reservation.id)
      .firstOrFail()

    const revert = await client
      .delete(`/api/v1/reservations/${reservation.id}/payments/${payment.id}`)
      .loginAs(staff)
    revert.assertStatus(200)

    // El filtro vive en el onQuery de la relación Reservation.payments, así que
    // cualquier preload nuevo lo hereda sin que nadie se acuerde de agregarlo.
    const body = revert.body()
    assert.isArray(body.payments)
    assert.lengthOf(body.payments, 0)
  })
})
