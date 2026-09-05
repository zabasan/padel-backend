import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  createStaff,
  createCustomer,
  createPadelCourt,
  createRecurringReservation,
  setPromoSettings,
  openCashSession,
} from './fixtures.js'

// Opt-out por reserva de la promo de partidos consecutivos. La configuración global
// (`recurringPromoEnabled`) queda intacta: lo que cambia es si ESTA serie participa.
test.group('PATCH /reservations/:id/promo — opt-out por reserva', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await setPromoSettings({ enabled: true, games: 4, freeGames: 1 })
  })

  test('apagar la promo resetea la racha a 0', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 3,
      lastIncrementedWeeksAgo: 1,
    })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/promo`)
      .loginAs(staff)
      .json({ promoEnabled: false })
    response.assertStatus(200)

    await reservation.refresh()
    assert.isFalse(reservation.promoEnabled)
    assert.equal(reservation.consecutiveGames, 0)
    assert.isNull(reservation.lastIncrementedAt)
  })

  test('volver a prenderla deja la racha en 0 — no restaura la vieja', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 3,
    })

    await client
      .patch(`/api/v1/reservations/${reservation.id}/promo`)
      .loginAs(staff)
      .json({ promoEnabled: false })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/promo`)
      .loginAs(staff)
      .json({ promoEnabled: true })
    response.assertStatus(200)

    await reservation.refresh()
    assert.isTrue(reservation.promoEnabled)
    assert.equal(reservation.consecutiveGames, 0)
  })

  test('una reserva nace con la promo activa', async ({ assert }) => {
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    assert.isTrue(reservation.promoEnabled)
  })

  test('un cliente no puede tocar la promo de su propia reserva', async ({ client }) => {
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer)

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/promo`)
      .loginAs(customer)
      .json({ promoEnabled: false })
    response.assertStatus(403)
  })
})

test.group('promo apagada — la racha no avanza ni hay partido gratis', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await setPromoSettings({ enabled: true, games: 4, freeGames: 1 })
    await openCashSession()
  })

  test('el pago total no suma partidos con la promo apagada', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 0,
      promoEnabled: false,
    })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 0)
  })

  test('el pago total fuerza el 0 aunque quedara una racha vieja', async ({ client, assert }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 3,
      promoEnabled: false,
    })

    const response = await client
      .patch(`/api/v1/reservations/${reservation.id}/pay-total`)
      .loginAs(staff)
      .json({ efectivo: 2000 })
    response.assertStatus(200)

    await reservation.refresh()
    assert.equal(reservation.consecutiveGames, 0)
  })

  test('nunca marca partido gratis, aunque la racha esté en el borde del ciclo', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    // 4 partidos con `games: 4` es exactamente la posición del gratis.
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 4,
      promoEnabled: false,
    })

    const response = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(staff)
    response.assertStatus(200)

    assert.isFalse(response.body().isFreeGame)
    assert.isFalse(response.body().promoEnabled)
    assert.isUndefined(response.body().consecutiveGamesDisplay)
  })

  test('con la promo prendida, esa misma racha sí marca partido gratis', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const court = await createPadelCourt(2000)
    const customer = await createCustomer()
    const reservation = await createRecurringReservation(court, customer, {
      consecutiveGames: 4,
      promoEnabled: true,
    })

    const response = await client.get(`/api/v1/reservations/${reservation.id}`).loginAs(staff)
    response.assertStatus(200)

    assert.isTrue(response.body().isFreeGame)
    assert.equal(response.body().consecutiveGamesDisplay, 4)
  })
})
