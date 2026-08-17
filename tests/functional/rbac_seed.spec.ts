import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import {
  MODULE_NAMES,
  ROLE_PERMISSION_MATRIX,
  SEEDED_ROLES,
} from '#database/seed_data/permission_matrix'

/**
 * Verifies the migrations in 1781000000001..005 actually seeded the real
 * database the way permission_matrix.ts (and permission_matrix.spec.ts,
 * which tests the constant) says they should — the DB-level half of the
 * "Gate before proceeding" check in the rollout plan.
 */
test.group('RBAC seed — migrated database matches the source-of-truth matrix', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /**
   * These assert the SEED is intact, never that the database holds nothing else.
   * The roles ABM lets admins create roles at runtime and `.env.test` points at
   * the real dev database, so any exact global count here would go red the first
   * time someone uses the screen — including soft-deleted roles, whose rows stay
   * on disk by design.
   */

  test('all 5 seeded roles exist', async ({ assert }) => {
    const roles = await db.from('roles').whereNull('deleted_at').select('name')
    const names = roles.map((r) => r.name)
    for (const seeded of SEEDED_ROLES) {
      assert.include(names, seeded, `seeded role "${seeded}" is missing from the database`)
    }
  })

  test('every catalog module exists', async ({ assert }) => {
    const count = await db.from('modules').count('* as c')
    assert.equal(Number(count[0].c), MODULE_NAMES.length)
  })

  test('role_permissions has exactly one live row per (role, module)', async ({ assert }) => {
    const count = await db
      .from('role_permissions')
      .join('roles', 'roles.id', 'role_permissions.role_id')
      .whereIn('roles.name', [...SEEDED_ROLES])
      .whereNull('role_permissions.deleted_at')
      .count('* as c')
    assert.equal(Number(count[0].c), SEEDED_ROLES.length * MODULE_NAMES.length)
  })

  test('admin and supervisor matrices in the DB match the constant exactly', async ({ assert }) => {
    for (const roleName of ['admin', 'supervisor'] as const) {
      const rows = await db
        .from('role_permissions')
        .join('roles', 'roles.id', 'role_permissions.role_id')
        .where('roles.name', roleName)
        .whereNull('roles.deleted_at')
        .whereNull('role_permissions.deleted_at')
        .select('module', 'view', 'create', 'update', 'erase')

      const fromDb: Record<
        string,
        { view: boolean; create: boolean; update: boolean; erase: boolean }
      > = {}
      for (const row of rows) {
        fromDb[row.module] = {
          view: Boolean(row.view),
          create: Boolean(row.create),
          update: Boolean(row.update),
          erase: Boolean(row.erase),
        }
      }

      assert.deepEqual(fromDb, ROLE_PERMISSION_MATRIX[roleName])
    }
  })

  test('every existing user has role_id in sync with role — the rollout gate', async ({
    assert,
  }) => {
    const mismatches = await db.rawQuery(
      'SELECT COUNT(*) as c FROM users u JOIN roles r ON r.id = u.role_id WHERE u.role <> r.name'
    )
    assert.equal(Number(mismatches[0][0].c), 0)
  })

  // Pre-flight gate for Step 3 (route annotation). The consistency check above uses a JOIN,
  // which silently SKIPS any row with role_id IS NULL — it would report 0 mismatches even if
  // every such user is one. A NULL role_id resolves to an empty PermissionMap, so that user is
  // locked out of everything the moment its module gets annotated with `middleware.permission`.
  test('no user has role_id IS NULL — they would be locked out once routes are annotated', async ({
    assert,
  }) => {
    const count = await db.from('users').whereNull('role_id').count('* as c')
    assert.equal(Number(count[0].c), 0)
  })
})
