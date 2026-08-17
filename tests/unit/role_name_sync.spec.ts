import { test } from '@japa/runner'
import { resolveRoleSync, type RoleLookupEntry } from '#services/role_sync'

const ROLES: RoleLookupEntry[] = [
  { id: 1, name: 'admin' },
  { id: 2, name: 'supervisor' },
  { id: 3, name: 'worker' },
  { id: 4, name: 'customer' },
  { id: 5, name: 'professor' },
]

test.group('resolveRoleSync — pure function, no DB', () => {
  test('roleId dirty: name follows the id', ({ assert }) => {
    const result = resolveRoleSync(
      { roleIdDirty: true, roleDirty: false, roleId: 3, role: 'customer' },
      ROLES
    )
    assert.deepEqual(result, { role: 'worker', roleId: 3 })
  })

  test('role dirty (roleId not): id follows the name — keeps the existing UsersPage <select> working', ({
    assert,
  }) => {
    const result = resolveRoleSync(
      { roleIdDirty: false, roleDirty: true, roleId: null, role: 'professor' },
      ROLES
    )
    assert.deepEqual(result, { role: 'professor', roleId: 5 })
  })

  test('both dirty: roleId wins', ({ assert }) => {
    const result = resolveRoleSync(
      { roleIdDirty: true, roleDirty: true, roleId: 1, role: 'customer' },
      ROLES
    )
    assert.deepEqual(result, { role: 'admin', roleId: 1 })
  })

  test('neither dirty: no-op, proving the zero-extra-query path', ({ assert }) => {
    const result = resolveRoleSync(
      { roleIdDirty: false, roleDirty: false, roleId: 3, role: 'worker' },
      ROLES
    )
    assert.deepEqual(result, { role: 'worker', roleId: 3 })
  })

  test('unknown role name throws rather than silently desyncing', ({ assert }) => {
    assert.throws(() =>
      resolveRoleSync({ roleIdDirty: false, roleDirty: true, roleId: null, role: 'ghost' }, ROLES)
    )
  })

  test('unknown role id throws rather than silently desyncing', ({ assert }) => {
    assert.throws(() =>
      resolveRoleSync({ roleIdDirty: true, roleDirty: false, roleId: 999, role: 'worker' }, ROLES)
    )
  })

  test('roleId dirty to null clears role linkage without a lookup', ({ assert }) => {
    const result = resolveRoleSync(
      { roleIdDirty: true, roleDirty: false, roleId: null, role: 'worker' },
      ROLES
    )
    assert.deepEqual(result, { role: 'worker', roleId: null })
  })
})
