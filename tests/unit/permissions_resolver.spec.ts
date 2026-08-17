import { test } from '@japa/runner'
import {
  can,
  isSubsetOf,
  mergePermissionRows,
  type ModulePermissions,
  type PermissionRow,
} from '#services/permissions'
import { MODULE_NAMES } from '#database/seed_data/permission_matrix'

const NONE: ModulePermissions = { view: false, create: false, update: false, erase: false }
const ALL: ModulePermissions = { view: true, create: true, update: true, erase: true }

function row(module: string, overrides: Partial<PermissionRow> = {}): PermissionRow {
  return { module, view: false, create: false, update: false, erase: false, ...overrides }
}

test.group('permissions resolver — mergePermissionRows / can', () => {
  test('D3 headline: user row of all-false cannot revoke a role grant', ({ assert }) => {
    const map = mergePermissionRows(
      ['users'],
      [row('users', { view: true, create: true, update: true, erase: true })],
      [row('users', { view: false, create: false, update: false, erase: false })]
    )
    assert.deepEqual(map.users, { view: true, create: true, update: true, erase: true })
  })

  test('union adds: role view + user create both survive', ({ assert }) => {
    const map = mergePermissionRows(
      ['users'],
      [row('users', { view: true })],
      [row('users', { create: true })]
    )
    assert.deepEqual(map.users, { view: true, create: true, update: false, erase: false })
  })

  test('no rows at all: every catalog module present, all-false, no undefined', ({ assert }) => {
    const map = mergePermissionRows(MODULE_NAMES, [], [])
    for (const name of MODULE_NAMES) {
      assert.property(map, name)
      assert.deepEqual(map[name], { view: false, create: false, update: false, erase: false })
    }
  })

  test('roleId null (no role rows) still applies user rows', ({ assert }) => {
    const map = mergePermissionRows(['stats'], [], [row('stats', { view: true })])
    assert.isTrue(map.stats.view)
  })

  test('unknown module in a permission row does not crash and is ignored', ({ assert }) => {
    const map = mergePermissionRows(['users'], [row('inexistente', { view: true })], [])
    assert.isFalse(can(map, 'inexistente', 'view'))
    assert.deepEqual(map.users, { view: false, create: false, update: false, erase: false })
  })

  test('can() is total: unknown module or action returns false, never throws', ({ assert }) => {
    const map = mergePermissionRows(['users'], [], [])
    assert.isFalse(can(map, 'inexistente', 'view'))
    // @ts-expect-error - deliberately passing a garbage action to prove can() never throws
    assert.isFalse(can(map, 'users', 'launch_missiles'))
  })

  test('merge is commutative: role/user order does not matter', ({ assert }) => {
    const a = mergePermissionRows(
      ['users'],
      [row('users', { view: true })],
      [row('users', { create: true })]
    )
    const b = mergePermissionRows(
      ['users'],
      [row('users', { create: true })],
      [row('users', { view: true })]
    )
    assert.deepEqual(a, b)
  })

  test('merging a map with itself is idempotent', ({ assert }) => {
    const rows = [row('users', { view: true, update: true })]
    const once = mergePermissionRows(['users'], rows, [])
    const twice = mergePermissionRows(['users'], rows, rows)
    assert.deepEqual(once, twice)
  })
})

test.group('isSubsetOf — D7 building block, pure', () => {
  test('equal maps are subsets of each other', ({ assert }) => {
    assert.isTrue(isSubsetOf({ users: ALL }, { users: ALL }))
    assert.isTrue(isSubsetOf({ users: NONE }, { users: NONE }))
  })

  test('a map missing one boolean the other holds is NOT a subset', ({ assert }) => {
    const candidate = { users: { ...NONE, erase: true } }
    const actor = { users: { ...ALL, erase: false } }
    assert.isFalse(isSubsetOf(candidate, actor))
  })

  test('an empty (all-false) map is a subset of everything, including another empty map', ({
    assert,
  }) => {
    assert.isTrue(isSubsetOf({ users: NONE }, { users: ALL }))
    assert.isTrue(isSubsetOf({ users: NONE }, { users: NONE }))
  })

  test('a module the actor lacks entirely (missing key) is treated as all-false', ({ assert }) => {
    // No `roles` key on the actor at all — must behave exactly like an
    // explicit all-false entry, not throw and not silently pass.
    assert.isFalse(isSubsetOf({ roles: ALL }, { users: ALL }))
    assert.isTrue(isSubsetOf({ roles: NONE }, { users: ALL }))
  })

  test('multi-module: candidate must be covered on every module, not just one', ({ assert }) => {
    const candidate = { users: ALL, courts: NONE }
    const actorMissingUsers = { users: NONE, courts: ALL }
    const actorHasBoth = { users: ALL, courts: ALL }
    assert.isFalse(isSubsetOf(candidate, actorMissingUsers))
    assert.isTrue(isSubsetOf(candidate, actorHasBoth))
  })

  test('the supervisor/worker/admin matrix reproduces the expected D7 outcomes', ({ assert }) => {
    // worker is a proper subset of supervisor (every module) -> assignable.
    // admin is NOT a subset of supervisor (roles/user_permissions) -> refused.
    const supervisor = mergePermissionRows(
      MODULE_NAMES,
      MODULE_NAMES.map((m) => row(m, m === 'roles' || m === 'user_permissions' ? {} : ALL)),
      []
    )
    const worker = mergePermissionRows(
      MODULE_NAMES,
      MODULE_NAMES.map((m) => row(m, ['courts', 'reservations'].includes(m) ? ALL : {})),
      []
    )
    const admin = mergePermissionRows(
      MODULE_NAMES,
      MODULE_NAMES.map((m) => row(m, ALL)),
      []
    )

    assert.isTrue(isSubsetOf(worker, supervisor))
    assert.isFalse(isSubsetOf(admin, supervisor))
  })
})
