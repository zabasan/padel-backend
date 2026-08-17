import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { resolvePermissionsForUser } from '#services/permissions'
import {
  createAdmin,
  createFootballCourt,
  createPadelCourt,
  createProfessor,
  createUserWithPermissions,
  nowART,
  setProfessorHours,
} from './fixtures.js'

/**
 * The professor hour window (`professorStartHour`/`professorEndHour`) used to fire on
 * `isProfessor || targetIsProfessor`, so it blocked STAFF too whenever the reservation's
 * customer happened to be a professor — nobody could put a class in the peak slot.
 *
 * `reservation_overrides.create` now skips the window. These tests pin both halves of
 * that split, plus the one rule the override must NOT leak into: professors are still
 * padel-only. Which ROLES hold the override is a business decision (admin and supervisor
 * at the time of writing) and deliberately not asserted here — the grant is.
 *
 * `createProfessor()` stays a role fixture on purpose: unlike a permission grant, being
 * a professor is the domain fact the rule keys on (`role === 'professor'` in the
 * controller), so it is genuinely the subject rather than an access decision.
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

  test('professor booking for themselves is still blocked in the peak slot', async ({
    client,
    assert,
  }) => {
    const professor = await createProfessor()
    const court = await createPadelCourt()

    /**
     * Stated as a precondition rather than assumed. This is the one place in the suite
     * where a Roles ABM change SHOULD stop the test: granting professors
     * `reservation_overrides.create` is a deliberate change to the business rule this
     * test protects, not an incidental permission tweak. Asserting it here turns that
     * into a legible failure instead of a puzzling 201-where-400-was-expected.
     */
    const perms = await resolvePermissionsForUser(professor)
    assert.isFalse(
      perms.reservation_overrides.create,
      'precondition: this test covers a professor WITHOUT the override. Professors were ' +
        'granted reservation_overrides.create, which intentionally changes the hour-window ' +
        'rule — revisit this test rather than patching around it.'
    )

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

  /**
   * These two isolate the variable down to a single grant.
   *
   * Admin-vs-worker differed on many permissions at once, so it never proved WHICH one
   * opened the slot — and it broke as soon as worker was retuned in the Roles ABM. Both
   * actors below are identical staff (reservations.create + reservation_management.view,
   * enough to book on someone else's behalf); the ONLY difference is the override grant,
   * so the 400 becoming a 201 can be nothing else.
   */
  const STAFF_GRANTS = {
    reservations: { view: true, create: true },
    reservation_management: { view: true },
  }

  test('staff without reservation_overrides.create cannot book the peak slot for a professor', async ({
    client,
  }) => {
    const staff = await createUserWithPermissions(STAFF_GRANTS)
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
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

  test('the same staff WITH reservation_overrides.create can book it', async ({ client }) => {
    const staff = await createUserWithPermissions({
      ...STAFF_GRANTS,
      reservation_overrides: { create: true },
    })
    const professor = await createProfessor()
    const court = await createPadelCourt()

    const response = await client.post('/api/v1/reservations').loginAs(staff).json({
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
