// Shared fixture builders for the functional suite. NOT a *.spec.ts file, so Japa's
// `tests/functional/**/*.spec.{ts,js}` glob never picks it up as a standalone test.
//
// IMPORTANT: `.env.test` points at the real dev database (no isolated test DB exists for
// this project). Every functional test group MUST wrap each test in a rolled-back global
// transaction via `group.each.setup(() => testUtils.db().withGlobalTransaction())` so
// nothing written here ever survives past the test. Never rely on committed fixtures.
import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import User from '#models/user'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import CourtPriceHistory from '#models/court_price_history'
import Reservation from '#models/reservation'
import Role from '#models/role'
import Setting from '#models/setting'
import Product from '#models/product'
import { setRolePermission, setUserPermission, type ModulePermissions } from '#services/permissions'

const ART_TZ = 'America/Argentina/Buenos_Aires'

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}-${Math.round(Math.random() * 1e6)}`
}

export async function createWorker(): Promise<User> {
  return User.create({
    fullName: 'Fixture Worker',
    email: `${unique('fixture-worker')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'worker',
  })
}

export async function createAdmin(): Promise<User> {
  return User.create({
    fullName: 'Fixture Admin',
    email: `${unique('fixture-admin')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'admin',
  })
}

// Zero real users hold this role today — it exists so the RBAC subset guard
// (D7) has something weaker than admin to test against.
export async function createSupervisor(): Promise<User> {
  return User.create({
    fullName: 'Fixture Supervisor',
    email: `${unique('fixture-supervisor')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'supervisor',
  })
}

export async function createProfessor(): Promise<User> {
  return User.create({
    fullName: 'Fixture Professor',
    email: `${unique('fixture-professor')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'professor',
  })
}

export async function createCustomer(): Promise<User> {
  return User.create({
    fullName: 'Fixture Customer',
    email: `${unique('fixture-customer')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    role: 'customer',
  })
}

/**
 * A user holding EXACTLY the grants asked for and nothing else — the base for
 * every permission-gate test.
 *
 * Why not `createCustomer()` as the baseline: `customer` already holds
 * `courts.view` and `reservations.vcue` in the seeded matrix, so it is not a
 * clean zero on those modules. And `setUserPermission` is additive by design
 * (OR-merge, D3) — a false extra CANNOT revoke a role grant — so the only way
 * to express "does not hold X" is a base that genuinely lacks it.
 *
 * The bare custom role has no `role_permissions` rows at all, which resolves to
 * all-false for every catalog module (mergePermissionRows seeds the catalog
 * denied, then OR-s grants in). Role.create fires the afterSave hook that
 * invalidates the role cache, so User's syncRoleWithRoleId resolves the brand
 * new name on the very next save.
 *
 * Tests written against this are immune to permission changes made through the
 * Roles ABM — which is the whole point: who holds what is a business decision,
 * while "this route is gated on this {module, action}" is the code contract.
 */
/**
 * A role with no `role_permissions` rows — grants nothing on any module.
 *
 * Useful on its own as the role to ASSIGN in a users_controller test: D7
 * (assertRoleAssignable) refuses to let an actor hand out a role holding
 * permissions the actor lacks, and the empty set is a subset of every set. Any
 * seeded role name would drag that rule into a test that is not about it — the
 * default `customer` holds courts.view + reservations.vcue, so it is NOT freely
 * assignable.
 */
export async function createBareRole(): Promise<Role> {
  return Role.create({
    name: unique('fixture-role').slice(0, 50),
    description: 'Bare role for permission-gate tests — no role_permissions rows.',
  })
}

const fill = (perms: Partial<ModulePermissions>): ModulePermissions => ({
  view: perms.view ?? false,
  create: perms.create ?? false,
  update: perms.update ?? false,
  erase: perms.erase ?? false,
})

/**
 * A custom role holding exactly `grants` at the ROLE level.
 *
 * Use this (over a seeded role name) whenever a test needs a known role grid —
 * the three-layer roleGrid/userGrid/effective model, or D7's subset comparison.
 * Pinning those to `worker`'s or `admin`'s seeded grid makes them fail the moment
 * someone retunes that role in the ABM, which is a supported action.
 */
export async function createRoleWithPermissions(
  grants: Record<string, Partial<ModulePermissions>> = {}
): Promise<Role> {
  const role = await createBareRole()
  for (const [module, perms] of Object.entries(grants)) {
    await setRolePermission(role.id, module, fill(perms))
  }
  return role
}

/**
 * A staff actor for tests whose SUBJECT is business logic — pricing, streaks, promos,
 * the stock ledger — and which merely need somebody authorised to drive the endpoints.
 *
 * Use this instead of `createWorker()` in those tests. Reaching for a seeded role there
 * looks harmless but silently binds the test to that role's current grants: revoking one
 * of worker's permissions through the Roles ABM (a supported action) took 20 unrelated
 * business-logic tests down with it, none of which was asserting anything about roles.
 *
 * The grants are broad ON PURPOSE — this actor is scaffolding, not the thing under test.
 * When the permission boundary IS the subject, use `createUserWithPermissions` with the
 * narrow set you mean to prove.
 */
export function createStaff(): Promise<User> {
  const all = { view: true, create: true, update: true, erase: true }
  return createUserWithPermissions({
    reservations: all,
    reservation_management: all,
    payments: all,
    products: all,
    sales: all,
    users: all,
  })
}

export async function createUserWithPermissions(
  grants: Record<string, Partial<ModulePermissions>> = {},
  opts: { role?: Role } = {}
): Promise<User> {
  const role = opts.role ?? (await createBareRole())

  const user = await User.create({
    fullName: 'Fixture Granted User',
    email: `${unique('fixture-granted')}@example.test`,
    phone: unique('phone').slice(0, 15),
    password: await hash.make('fixturepass123'),
    roleId: role.id,
  })

  for (const [module, perms] of Object.entries(grants)) {
    await setUserPermission(user.id, module, fill(perms))
  }

  return user
}

// Padel court with a single all-day price range so calcRecurringOccurrencePrice has a
// deterministic, hour-independent price to work with.
export async function createPadelCourt(pricePerHour = 2000): Promise<Court> {
  const court = await Court.create({
    name: unique('Fixture Padel Court'),
    type: 'padel',
    description: 'Fixture court for functional tests',
    pricePerHour,
    isActive: true,
  })
  await CourtPriceRange.create({
    courtId: court.id,
    startHour: 0,
    endHour: 24,
    pricePerHour,
    isPeakHour: false,
    price60Min: pricePerHour,
    price90Min: Math.round(pricePerHour * 1.5),
    price120Min: pricePerHour * 2,
  })
  return court
}

// Football counterpart of createPadelCourt — needed to prove the professor "padel only"
// rule stays enforced even for actors who can override the hour window.
export async function createFootballCourt(pricePerHour = 5000): Promise<Court> {
  const court = await Court.create({
    name: unique('Fixture Football Court'),
    type: 'football',
    description: 'Fixture court for functional tests',
    pricePerHour,
    isActive: true,
  })
  await CourtPriceRange.create({
    courtId: court.id,
    startHour: 0,
    endHour: 24,
    pricePerHour,
    isPeakHour: false,
    price60Min: pricePerHour,
    price90Min: Math.round(pricePerHour * 1.5),
    price120Min: pricePerHour * 2,
  })
  return court
}

// Pins the professor hour window. `.env.test` points at the real dev DB, where an admin may
// have changed these, so any test asserting on the window must set it explicitly.
export async function setProfessorHours(startHour: number, endHour: number): Promise<void> {
  await Setting.updateOrCreate(
    { key: 'professorStartHour' },
    { key: 'professorStartHour', value: String(startHour) }
  )
  await Setting.updateOrCreate(
    { key: 'professorEndHour' },
    { key: 'professorEndHour', value: String(endHour) }
  )
}

// Writes one all-day price batch into `court_price_history`, effective from `effectiveFrom`.
// Call it once per price change so `getHistoricalRanges` has distinct batches to choose from and
// a test can prove which occurrence date a price was resolved against.
export async function addCourtPriceHistory(
  court: Court,
  pricePerHour: number,
  effectiveFrom: DateTime
): Promise<void> {
  await CourtPriceHistory.create({
    courtId: court.id,
    effectiveFrom,
    startHour: 0,
    endHour: 24,
    pricePerHour,
    isPeakHour: false,
    price60Min: pricePerHour,
    price90Min: Math.round(pricePerHour * 1.5),
    price120Min: pricePerHour * 2,
  })
}

// Sets/overwrites the recurring-promo settings rows (upsert, safe inside a rolled-back tx).
export async function setPromoSettings(opts: {
  enabled: boolean
  games: number
  freeGames: number
}): Promise<void> {
  await Setting.updateOrCreate(
    { key: 'recurringPromoEnabled' },
    { key: 'recurringPromoEnabled', value: String(opts.enabled) }
  )
  await Setting.updateOrCreate(
    { key: 'recurringPromoGames' },
    { key: 'recurringPromoGames', value: String(opts.games) }
  )
  await Setting.updateOrCreate(
    { key: 'recurringPromoFreeGames' },
    { key: 'recurringPromoFreeGames', value: String(opts.freeGames) }
  )
}

// Commerce fixture. Stock is written straight onto the column here on purpose — these tests
// assert what the CONTROLLERS do to stock, so the starting point has to be set without going
// through applyStockMovement (which is the thing under test).
export async function createProduct(
  opts: {
    name?: string
    price?: number
    cost?: number
    stock?: number
    minStock?: number
    trackStock?: boolean
    isActive?: boolean
    categoryId?: number | null
  } = {}
): Promise<Product> {
  return Product.create({
    name: opts.name ?? unique('Fixture Product'),
    categoryId: opts.categoryId ?? null,
    sku: null,
    price: opts.price ?? 1000,
    cost: opts.cost ?? 400,
    stock: opts.stock ?? 10,
    minStock: opts.minStock ?? 0,
    trackStock: opts.trackStock ?? true,
    isActive: opts.isActive ?? true,
  })
}

// Today's date/time in ART, used as the deterministic anchor for "next occurrence" math.
export function nowART(): DateTime {
  return DateTime.now().setZone(ART_TZ)
}

// Builds a weekly recurring reservation whose weekday matches "today" (ART), so
// `nextOccurrenceDate`/`nextDueOccurrence` resolve the pending occurrence to `todayISODate()`
// when called with `now`. `weeksAgo` anchors the series' original `startTime` in the past
// (purely cosmetic unless a test also sets `lastIncrementedAt`/hidden dates further back).
export async function createRecurringReservation(
  court: Court,
  targetUser: User,
  opts: {
    hour?: number
    weeksAgo?: number
    consecutiveGames?: number
    lastIncrementedWeeksAgo?: number | null
    depositPercentage?: number | null
    depositFixedAmount?: number | null
    depositPaid?: boolean
    totalPrice?: number
    discountPercentage?: number
    customPrice?: number | null
  } = {}
): Promise<Reservation> {
  const hour = opts.hour ?? 10
  const weeksAgo = opts.weeksAgo ?? 8
  const today = nowART().startOf('day').set({ hour })
  const startTime = today.minus({ weeks: weeksAgo })
  const endTime = startTime.plus({ minutes: 60 })

  const lastIncrementedAt =
    opts.lastIncrementedWeeksAgo != null
      ? today.minus({ weeks: opts.lastIncrementedWeeksAgo })
      : null

  return Reservation.create({
    courtId: court.id,
    userId: targetUser.id,
    startTime,
    endTime,
    totalPrice: opts.totalPrice ?? 2000,
    status: 'confirmed',
    isRecurring: true,
    depositPercentage: opts.depositPercentage ?? null,
    depositFixedAmount: opts.depositFixedAmount ?? null,
    depositPaid: opts.depositPaid ?? false,
    totalPaid: false,
    discountPercentage: opts.discountPercentage ?? 0,
    consecutiveGames: opts.consecutiveGames ?? 0,
    lastIncrementedAt,
    customPrice: opts.customPrice ?? null,
  })
}

export function todayISODate(): string {
  return nowART().toISODate()!
}

export function weeksAgoISODate(weeks: number): string {
  return nowART().startOf('day').minus({ weeks }).toISODate()!
}

export function weeksAheadISODate(weeks: number): string {
  return nowART().startOf('day').plus({ weeks }).toISODate()!
}
