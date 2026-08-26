// Shared fixture builders for the functional suite. NOT a *.spec.ts file, so Japa's
// `tests/functional/**/*.spec.{ts,js}` glob never picks it up as a standalone test.
//
// The suite runs against its own database (`padel_test`, created and migrated by
// `tests/test_database.ts` — never the dev one). Even so, every functional test group
// MUST wrap each test in a rolled-back global transaction via
// `group.each.setup(() => testUtils.db().withGlobalTransaction())`: that is what keeps
// tests from leaking into each other and what keeps the schema-only test database from
// accumulating rows across runs. Never rely on committed fixtures.
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
import Expense from '#models/expense'
import CashSession from '#models/cash_session'
import ExpenseCategory from '#models/expense_category'
import { setRolePermission, setUserPermission, type ModulePermissions } from '#services/permissions'
import { loadShifts, shiftForCharge } from '#services/cash_shifts'
import { newSessionFields } from '#services/cash_register'

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
/**
 * Pass `parentCourtId` to model a divisible field: the parent is the whole pitch and each
 * child is one of the halves it splits into. Booking either side blocks the other.
 */
export async function createFootballCourt(
  pricePerHour = 5000,
  opts: { parentCourtId?: number } = {}
): Promise<Court> {
  const court = await Court.create({
    name: unique('Fixture Football Court'),
    type: 'football',
    description: 'Fixture court for functional tests',
    pricePerHour,
    isActive: true,
    parentCourtId: opts.parentCourtId ?? null,
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

// Pins the professor hour window. Settings are a persisted singleton, so a test asserting on
// the window must set it explicitly instead of inheriting whatever value is on disk.
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

// Pins the professor class rates. Same reason as setProfessorHours: any test asserting on a
// professor price must set it explicitly rather than inherit it. Weekday and
// weekend individual rates default to the SAME value on purpose — a test about who may set a
// price should not also depend on which weekday "tomorrow" happens to fall on. The weekend
// surcharge itself is covered in tests/unit/weekend_surcharge.spec.ts.
export async function setProfessorPrices(opts: {
  individual: number
  group: number
  individualWeekend?: number
}): Promise<void> {
  const rows: Record<string, number> = {
    professorPriceIndividual: opts.individual,
    professorPriceIndividualWeekend: opts.individualWeekend ?? opts.individual,
    professorPriceGroup: opts.group,
  }
  for (const [key, value] of Object.entries(rows)) {
    await Setting.updateOrCreate({ key }, { key, value: String(value) })
  }
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

// Expense fixtures. `expenseDate` defaults to today (ART) so a test that does not care about
// dating lands inside any "current period" stats window without saying so.
export async function createExpenseCategory(name?: string): Promise<ExpenseCategory> {
  return ExpenseCategory.create({
    name: name ?? unique('Fixture Expense Cat').slice(0, 80),
    isActive: true,
  })
}

export async function createExpense(
  creator: User,
  opts: {
    amount?: number
    categoryId?: number | null
    description?: string
    supplier?: string | null
    efectivo?: number
    transferencia?: number
    postnet?: number
    expenseDate?: string
    status?: 'completed' | 'cancelled'
  } = {}
): Promise<Expense> {
  const amount = opts.amount ?? 10000
  // Mirrors the controller's "no split sent means all cash" rule so a fixture built
  // without a split is still a coherent row.
  const efectivo = opts.efectivo ?? (opts.transferencia || opts.postnet ? 0 : amount)

  return Expense.create({
    categoryId: opts.categoryId ?? null,
    description: opts.description ?? unique('Fixture Expense').slice(0, 200),
    supplier: opts.supplier ?? null,
    amount,
    efectivo,
    transferencia: opts.transferencia ?? 0,
    postnet: opts.postnet ?? 0,
    expenseDate: DateTime.fromISO(opts.expenseDate ?? todayISODate(), { zone: ART_TZ }),
    notes: null,
    status: opts.status ?? 'completed',
    createdBy: creator.id,
  })
}

// Today's date/time in ART, used as the deterministic anchor for "next occurrence" math.
/**
 * Abre la caja del turno que corresponde a AHORA.
 *
 * Desde que existe middleware.cashRegister, los ocho endpoints que mueven plata
 * devuelven 409 si la caja está cerrada. Cualquier grupo funcional que cobre, venda,
 * cargue un gasto o revierta un pago tiene que abrirla primero:
 *
 *   group.each.setup(() => testUtils.db().withGlobalTransaction())
 *   group.each.setup(async () => { await openCashSession() })
 *
 * El orden importa: la transacción va PRIMERO para que la sesión de caja se revierta
 * con el resto. Si se invierten, la sesión queda commiteada y el próximo test arranca
 * con una caja abierta que no abrió nadie.
 */
export async function openCashSession(opener?: User, openingEfectivo = 0): Promise<CashSession> {
  // Sin esto, todo test que abra una sesión choca contra la caja que el complejo tenga
  // abierta en la app. Ver closeAmbientCashRegister.
  await closeAmbientCashRegister()

  const user = opener ?? (await createStaff())
  const shifts = await loadShifts()
  const placement = shiftForCharge(DateTime.now(), shifts)
  return CashSession.create(newSessionFields(placement, user.id, openingEfectivo))
}

/**
 * Deja la caja CERRADA como precondición del test.
 *
 * Por qué hace falta: `cash_sessions` tiene un índice UNIQUE sobre `open_marker` que
 * garantiza el invariante "nunca hay más de una sesión abierta". Esa restricción es
 * GLOBAL: ve las filas commiteadas fuera de la transacción del test. Cuando la suite
 * corría contra la base de dev, alcanzaba con que alguien dejara la caja abierta en la
 * app para que ~100 tests fallaran con
 * `Duplicate entry '1' for key 'cash_sessions.cash_sessions_open_marker_unique'`.
 * Con `padel_test` eso ya no puede pasar, pero el fixture se queda: fija la precondición
 * explícitamente en vez de confiar en que la base esté limpia.
 *
 * Los demás fixtures conviven con la base compartida porque solo crean filas propias y
 * los tests afirman sobre deltas. La caja es lo primero que introduce un SINGLETON, y un
 * singleton no tolera una base compartida sin fijar la precondición.
 *
 * Por qué no ensucia nada: corre DENTRO de la transacción global del test, así que el
 * cierre se revierte al terminar y la caja real del complejo queda abierta e intacta.
 * Por eso es imprescindible registrarlo DESPUÉS de `withGlobalTransaction()`.
 *
 * Por qué no vive en un hook global de tests/bootstrap.ts: `suite.onGroup(...)` se
 * dispara desde `suite.add(group)`, que `createTestGroup()` llama ANTES de ejecutar el
 * cuerpo del grupo (@japa/runner build/create_test-*.js) — es decir, antes de que el
 * spec registre su `withGlobalTransaction()`. Un hook así correría fuera de la
 * transacción y le cerraría al complejo la caja de verdad.
 */
export async function closeAmbientCashRegister(): Promise<void> {
  const open = await CashSession.query().whereNull('closed_at')
  for (const session of open) {
    session.closedAt = DateTime.now()
    // NULL, no 0: es lo que libera el índice UNIQUE para la sesión del test.
    session.openMarker = null
    await session.save()
  }
}

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
