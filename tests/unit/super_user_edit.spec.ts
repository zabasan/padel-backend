import { test } from '@japa/runner'
import { DateTime } from 'luxon'

// ─── Guard (mirrors reservations_controller.ts) ───────────────────────────────

function canEditReservation(
  user: {
    isSuperUser: boolean
  },
  reservation: {
    isRecurring: boolean
    endTime: DateTime
  }
): { allowed: boolean; reason?: string } {
  if (!user.isSuperUser && !reservation.isRecurring && reservation.endTime < DateTime.now()) {
    return { allowed: false, reason: 'No se puede editar una reserva que ya ocurrió' }
  }
  return { allowed: true }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const pastTime = DateTime.now().minus({ hours: 2 })
const futureTime = DateTime.now().plus({ hours: 2 })

test.group('super_user — edit past confirmed reservations', () => {
  test('regular user cannot edit a past non-recurring reservation', ({ assert }) => {
    const result = canEditReservation(
      { isSuperUser: false },
      { isRecurring: false, endTime: pastTime }
    )
    assert.isFalse(result.allowed)
    assert.equal(result.reason, 'No se puede editar una reserva que ya ocurrió')
  })

  test('super user can edit a past non-recurring reservation', ({ assert }) => {
    const result = canEditReservation(
      { isSuperUser: true },
      { isRecurring: false, endTime: pastTime }
    )
    assert.isTrue(result.allowed)
  })

  test('regular user can edit a future non-recurring reservation', ({ assert }) => {
    const result = canEditReservation(
      { isSuperUser: false },
      { isRecurring: false, endTime: futureTime }
    )
    assert.isTrue(result.allowed)
  })

  test('regular user can edit a past recurring reservation', ({ assert }) => {
    const result = canEditReservation(
      { isSuperUser: false },
      { isRecurring: true, endTime: pastTime }
    )
    assert.isTrue(result.allowed)
  })

  test('super user can edit a past recurring reservation', ({ assert }) => {
    const result = canEditReservation(
      { isSuperUser: true },
      { isRecurring: true, endTime: pastTime }
    )
    assert.isTrue(result.allowed)
  })

  test('super user can edit a future reservation', ({ assert }) => {
    const result = canEditReservation(
      { isSuperUser: true },
      { isRecurring: false, endTime: futureTime }
    )
    assert.isTrue(result.allowed)
  })
})
