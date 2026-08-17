import { test } from '@japa/runner'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'

/**
 * Repo hygiene: `role_permissions` / `users_permissions` may be queried
 * ONLY from app/services/permissions.ts. Mechanically enforces the
 * single-resolution-point rule that contains the soft-delete revocation
 * risk (see permissions.ts's `livePermissionRows`) — a second query site is
 * a second place the `deleted_at` filter can be forgotten.
 */

const TABLE_NAMES = /role_permissions|users_permissions/

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (entry.name.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

// user_permission.ts must declare `static table = 'users_permissions'` (Lucid would
// otherwise infer `user_permissions`) — that is a table-name DECLARATION, not a query,
// so it is exempt. role_permission.ts needs no such declaration (Lucid's inferred
// `role_permissions` is already correct) and is deliberately NOT exempt here.
const ALLOWED_FILES = [join('services', 'permissions.ts'), join('models', 'user_permission.ts')]

test.group('permissions encapsulation', () => {
  test('role_permissions / users_permissions are queried only from services/permissions.ts', async ({
    assert,
  }) => {
    const appDir = app.makePath('app')
    const allFiles = await walk(appDir)

    const offenders: string[] = []
    for (const file of allFiles) {
      if (ALLOWED_FILES.some((allowed) => file.endsWith(allowed))) continue
      const content = await readFile(file, 'utf-8')
      if (TABLE_NAMES.test(content)) {
        offenders.push(file)
      }
    }

    assert.deepEqual(offenders, [])
  })
})
