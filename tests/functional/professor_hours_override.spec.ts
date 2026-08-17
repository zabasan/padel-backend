import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { setUserPermission } from '#services/permissions'
import {
  createAdmin,
  createFootballCourt,
  createPadelCourt,
  createProfessor,
  createWorker,
  nowART,
  setProfessorHours,
} from './fixtures.js'

/**
 * The professor hour window (`professorStartHour`/`professorEndHour`) used to fire on
 * `isProfessor || targetIsProfessor`, so it blocked STAFF too whenever the reservation's
 * customer happened to be a professor — nobody could put a class in the peak slot.
 *
 * `reservation_overrides.create` (admin + supervisor in the seeded matrix) now skips the
 * window. These tests pin both halves of that split, plus the one rule the override must
 * NOT leak into: professors are still padel-only.
 */
const PROF_START = 8
const PROF_END = 18

/** Tomorrow 19:00 ART — inside the peak band, past `professorEndHour`, and never in the past. */
function peakSlotISO(): string {
  return nowART().startOf('day').plus({ days: 1 }).set({ hour: 19 }).toISO()!
}

test.group('professor hour window — reservation_overrides.create', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => setProfessorHours(PROF_START, PROF_END))

  test('professor booking for themselves is still blocked in the peak slot', async ({ client }) => {
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client
      .post('/api/v1/reservations')
      .loginAs(professor)
      .json({ courtId: court.id, startTime: peakSlotISO(), duration: 60 })

    response.assertStatus(400)
    response.assertBodyContains({
      message: `Las reservas de profesores deben terminar a las ${PROF_END}:00 o antes`,
    })
  })

  test('admin can book the peak slot for a professor', async ({ client }) => {
    const admin = await createAdmin()
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(admin).json({
      courtId: court.id,
      startTime: peakSlotISO(),
      duration: 60,
      customerId: professor.id,
    })

    response.assertStatus(201)
    response.assertBodyContains({ userId: professor.id })
  })

  test('worker cannot book the peak slot for a professor (holds no override)', async ({
    client,
  }) => {
    const worker = await createWorker()
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(worker).json({
      courtId: court.id,
      startTime: peakSlotISO(),
      duration: 60,
      customerId: professor.id,
    })

    response.assertStatus(400)
    response.assertBodyContains({
      message: `Las reservas de profesores deben terminar a las ${PROF_END}:00 o antes`,
    })
  })

  // Isolates the variable. Admin-vs-worker differs on many permissions at once, so on its
  // own it does not prove WHICH one opened the slot. Here the actor is the same worker as
  // above, with `reservation_overrides.create` granted per-user and nothing else changed —
  // the 400 above becoming a 201 here can only be that grant. Doubles as proof the module
  // is genuinely grantable, which is the reason it exists apart from reservation_management.
  test('a per-user grant of reservation_overrides.create is enough for a worker', async ({
    client,
  }) => {
    const worker = await createWorker()
    const professor = await createProfessor()
    const court = await createPadelCourt()

    await setUserPermission(worker.id, 'reservation_overrides', {
      view: false,
      create: true,
      update: false,
      erase: false,
    })

    const response = await client.post('/api/v1/reservations').loginAs(worker).json({
      courtId: court.id,
      startTime: peakSlotISO(),
      duration: 60,
      customerId: professor.id,
    })

    response.assertStatus(201)
    response.assertBodyContains({ userId: professor.id })
  })

  // The override is scoped to the hour window only. Professor pricing is a per-hour class
  // rate that does not model a football court, so letting this through would produce a
  // wrong price rather than a more flexible reservation.
  test('admin still cannot book a football court for a professor', async ({ client }) => {
    const admin = await createAdmin()
    const professor = await createProfessor()
    const court = await createFootballCourt()

    const response = await client
      .post('/api/v1/reservations')
      .loginAs(admin)
      .json({
        courtId: court.id,
        startTime: nowART().startOf('day').plus({ days: 1 }).set({ hour: 10 }).toISO()!,
        duration: 60,
        customerId: professor.id,
      })

    response.assertStatus(400)
    response.assertBodyContains({ message: 'Los profesores solo pueden reservar canchas de pádel' })
  })
})
