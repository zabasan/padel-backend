import Role from '#models/role'

/**
 * Keeps `users.role` (legacy string, kept for backward compatibility) in
 * sync with `users.role_id` (the new FK). Application-level, not a DB
 * trigger — a trigger would be invisible in review, absent from the
 * generated schema.ts, and untestable in Japa.
 */

export interface RoleLookupEntry {
  id: number
  name: string
}

let cachedRoles: RoleLookupEntry[] | null = null

/** ~5 rows; cached across requests, invalidated on any Role write (see role.ts hooks). */
export async function getRolesCached(): Promise<RoleLookupEntry[]> {
  if (!cachedRoles) {
    const rows = await Role.query().whereNull('deletedAt').select('id', 'name')
    cachedRoles = rows.map((r) => ({ id: r.id, name: r.name }))
  }
  return cachedRoles
}

export function invalidateRoleCache() {
  cachedRoles = null
}

export async function findRoleIdByName(name: string): Promise<number | null> {
  const roles = await getRolesCached()
  return roles.find((r) => r.name === name)?.id ?? null
}

export interface ResolveRoleSyncInput {
  roleIdDirty: boolean
  roleDirty: boolean
  roleId: number | null
  role: string
}

/**
 * Pure function — no DB access — so it is unit-testable without a database
 * (house style, see tests/unit/super_user_edit.spec.ts).
 *
 * - roleId dirty -> look up the name, write it into `role`.
 * - role dirty (and roleId not) -> look up the id, write it into `roleId`.
 *   This is what keeps users_controller.update()'s `user.merge(data)` (a
 *   plain `role` string) and the existing UsersPage role <select> working
 *   with zero changes.
 * - Both dirty -> roleId wins.
 * - Neither dirty -> no-op, returned unchanged (zero extra queries on a
 *   normal save of name/phone/password).
 */
export function resolveRoleSync(
  input: ResolveRoleSyncInput,
  roles: RoleLookupEntry[]
): { role: string; roleId: number | null } {
  const { roleIdDirty, roleDirty, roleId, role } = input

  if (!roleIdDirty && !roleDirty) {
    return { role, roleId }
  }

  if (roleIdDirty) {
    if (roleId === null) return { role, roleId: null }
    const match = roles.find((r) => r.id === roleId)
    if (!match) throw new Error(`resolveRoleSync: unknown role id ${roleId}`)
    return { role: match.name, roleId }
  }

  const match = roles.find((r) => r.name === role)
  if (!match) throw new Error(`resolveRoleSync: unknown role name "${role}"`)
  return { role, roleId: match.id }
}
