import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import Role from '#models/role'
import { MODULE_NAMES } from '#database/seed_data/permission_matrix'

/**
 * The single resolution point for the permission system. This is the ONLY
 * file in the codebase permitted to query role_permissions or
 * users_permissions directly — every other consumer goes through can(),
 * resolvePermissionsForUser(), or getRequestPermissions().
 *
 * Layering contract (see plan §1): this resolves module-level (module,
 * action) gates only. It says nothing about row-level ownership (customers
 * seeing only their own reservations) or capability flags (isSuperUser) —
 * those stay exactly as they are, enforced inline in their controllers.
 */

export type PermissionAction = 'view' | 'create' | 'update' | 'erase'

export interface ModulePermissions {
  view: boolean
  create: boolean
  update: boolean
  erase: boolean
}

export type PermissionMap = Record<string, ModulePermissions>

export interface PermissionRow {
  module: string
  view: boolean
  create: boolean
  update: boolean
  erase: boolean
}

const EMPTY: ModulePermissions = { view: false, create: false, update: false, erase: false }

function orPerms(a: ModulePermissions, b: ModulePermissions): ModulePermissions {
  return {
    view: a.view || b.view,
    create: a.create || b.create,
    update: a.update || b.update,
    erase: a.erase || b.erase,
  }
}

/**
 * PURE — no DB access, unit-testable in isolation.
 *
 * Seeds an all-false entry for every catalog module first, then ORs in role
 * rows, then ORs in user rows. Two consequences: the map is always complete
 * (can() and the admin matrix UI never hit a hole), and union is add-only BY
 * CONSTRUCTION — a user row of all-false cannot revoke a role grant (D3).
 */
export function mergePermissionRows(
  moduleNames: string[],
  roleRows: PermissionRow[],
  userRows: PermissionRow[]
): PermissionMap {
  const map: PermissionMap = {}
  for (const name of moduleNames) {
    map[name] = { ...EMPTY }
  }
  for (const row of roleRows) {
    if (!map[row.module]) continue
    map[row.module] = orPerms(map[row.module], row)
  }
  for (const row of userRows) {
    if (!map[row.module]) continue
    map[row.module] = orPerms(map[row.module], row)
  }
  return map
}

/**
 * Soft-delete containment: whereNull('deleted_at') is written EXACTLY ONCE,
 * here. Every resolver and writer below goes through this.
 *
 * Soft delete is fail-CLOSED for grants (a missing/deleted row -> false,
 * denied). The real hazard is the opposite: a REVOCATION that doesn't stick
 * because a filter was missed somewhere else. Keeping this the single
 * chokepoint is what prevents that — see tests/unit/permissions_encapsulation.spec.ts.
 */
async function livePermissionRows(
  table: 'role_permissions' | 'users_permissions',
  fk: 'role_id' | 'user_id',
  id: number
): Promise<PermissionRow[]> {
  const rows = await db
    .from(table)
    .where(fk, id)
    .whereNull('deleted_at')
    .select('module', 'view', 'create', 'update', 'erase')

  // mysql2 returns TINYINT booleans as JS numbers (0/1), not real booleans.
  // Coerced here, the single chokepoint, so every consumer downstream (the
  // OR-merge in mergePermissionRows, and anything that serializes a
  // PermissionMap straight to JSON, like the roles/user_permissions
  // endpoints) gets true/false, never 1/0.
  return rows.map((row) => ({
    module: row.module,
    view: Boolean(row.view),
    create: Boolean(row.create),
    update: Boolean(row.update),
    erase: Boolean(row.erase),
  }))
}

async function roleRowsFor(roleId: number | null): Promise<PermissionRow[]> {
  if (roleId === null) return []
  return livePermissionRows('role_permissions', 'role_id', roleId)
}

async function userRowsFor(userId: number): Promise<PermissionRow[]> {
  return livePermissionRows('users_permissions', 'user_id', userId)
}

export async function resolvePermissionsForUser(user: User): Promise<PermissionMap> {
  const [roleRows, userRows] = await Promise.all([roleRowsFor(user.roleId), userRowsFor(user.id)])
  return mergePermissionRows(MODULE_NAMES, roleRows, userRows)
}

/**
 * The permission set a ROLE grants on its own, with no per-user extras
 * mixed in. Used only for the role-assignment subset check (D7) — see
 * isSubsetOf below — never for an actual session's effective permissions.
 */
export async function resolvePermissionsForRoleId(roleId: number): Promise<PermissionMap> {
  const roleRows = await roleRowsFor(roleId)
  return mergePermissionRows(MODULE_NAMES, roleRows, [])
}

/** Alias kept distinct from resolvePermissionsForRoleId so roles_controller.ts reads
 * naturally at the call site — same resolution, no behavior difference. */
export const getRolePermissionGrid = resolvePermissionsForRoleId

/**
 * The per-user EXTRAS only, with no role grant mixed in — what
 * user_permissions_controller.ts's GET needs to show "extended" separately
 * from "inherited". Never use this for an actual access decision (that's
 * resolvePermissionsForUser, which merges role + user).
 */
export async function getUserPermissionGrid(userId: number): Promise<PermissionMap> {
  const userRows = await userRowsFor(userId)
  return mergePermissionRows(MODULE_NAMES, [], userRows)
}

async function countUsersForRole(roleId: number): Promise<number> {
  const rows = await db.from('users').where('role_id', roleId).count('* as total')
  return Number(rows[0]?.total ?? 0)
}

export interface RoleWithGrid {
  id: number
  name: string
  description: string | null
  deletedAt: string | null
  grid: PermissionMap
  usersCount: number
}

/** All LIVE roles, each with its resolved grid and its assigned-users count — everything the
 * roles list screen needs in one call. */
export async function listRolesWithGrids(): Promise<RoleWithGrid[]> {
  const roles = await Role.query().whereNull('deletedAt').orderBy('name', 'asc')
  return Promise.all(
    roles.map(async (role) => {
      const [grid, usersCount] = await Promise.all([
        resolvePermissionsForRoleId(role.id),
        countUsersForRole(role.id),
      ])
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        deletedAt: role.deletedAt ? role.deletedAt.toISO() : null,
        grid,
        usersCount,
      }
    })
  )
}

const REQUEST_PERMISSIONS_CACHE = Symbol.for('padel.permissions.requestCache')

/**
 * Caches the PROMISE, not the resolved value, on the HttpContext, so a
 * request that hits stacked middleware groups or a controller that also
 * needs the map shares a single DB round trip (2 index-covered queries
 * worst case).
 */
export function getRequestPermissions(ctx: HttpContext): Promise<PermissionMap> {
  const cache = ctx as unknown as Record<symbol, Promise<PermissionMap> | undefined>
  if (!cache[REQUEST_PERMISSIONS_CACHE]) {
    if (!ctx.auth.user) {
      cache[REQUEST_PERMISSIONS_CACHE] = Promise.resolve(mergePermissionRows(MODULE_NAMES, [], []))
    } else {
      cache[REQUEST_PERMISSIONS_CACHE] = resolvePermissionsForUser(ctx.auth.user)
    }
  }
  return cache[REQUEST_PERMISSIONS_CACHE]!
}

/** Total: unknown module or action returns false, never undefined, never throws. */
export function can(map: PermissionMap, module: string, action: PermissionAction): boolean {
  return Boolean(map?.[module]?.[action])
}

/**
 * Writers. Both go through livePermissionRows' single deleted_at chokepoint.
 * The admin UI revokes by setting the four booleans to false, or by hard
 * DELETE — NEVER by setting deleted_at. deleted_at is reserved for role
 * LIFECYCLE (a whole role retired), so no resolver bug can resurrect a
 * revoked grant.
 */
export async function setRolePermission(
  roleId: number,
  module: string,
  perms: ModulePermissions
): Promise<void> {
  const existing = await db
    .from('role_permissions')
    .where('role_id', roleId)
    .where('module', module)
    .whereNull('deleted_at')
    .first()

  if (existing) {
    await db
      .from('role_permissions')
      .where('id', existing.id)
      .update({ ...perms, updated_at: new Date() })
  } else {
    await db.table('role_permissions').insert({
      role_id: roleId,
      module,
      ...perms,
      created_at: new Date(),
      updated_at: new Date(),
    })
  }
}

export async function setUserPermission(
  userId: number,
  module: string,
  perms: ModulePermissions
): Promise<void> {
  const existing = await db
    .from('users_permissions')
    .where('user_id', userId)
    .where('module', module)
    .whereNull('deleted_at')
    .first()

  if (existing) {
    await db
      .from('users_permissions')
      .where('id', existing.id)
      .update({ ...perms, updated_at: new Date() })
  } else {
    await db.table('users_permissions').insert({
      user_id: userId,
      module,
      ...perms,
      created_at: new Date(),
      updated_at: new Date(),
    })
  }
}

/**
 * D7 — the one validation that exists outside the permission screens
 * themselves: you may only assign a role whose full permission set is a
 * subset of your own effective map. Enforced in users_controller.store AND
 * .update — guarding only one of the two leaves the other as an open
 * escalation path (create a fresh admin account with a chosen password).
 *
 * Deliberately NOT used on the roles/user_permissions screens (D6) — there
 * it would be dead code, since only admins reach those endpoints and admins
 * hold every permission already.
 */
export function isSubsetOf(candidate: PermissionMap, actor: PermissionMap): boolean {
  for (const moduleName of Object.keys(candidate)) {
    const need = candidate[moduleName]
    const have = actor[moduleName] ?? EMPTY
    if (need.view && !have.view) return false
    if (need.create && !have.create) return false
    if (need.update && !have.update) return false
    if (need.erase && !have.erase) return false
  }
  return true
}

export async function assertCanAssignRole(
  actor: PermissionMap,
  targetRoleId: number
): Promise<void> {
  const targetPerms = await resolvePermissionsForRoleId(targetRoleId)
  if (!isSubsetOf(targetPerms, actor)) {
    throw new RoleAssignmentDeniedError()
  }
}

export class RoleAssignmentDeniedError extends Error {
  constructor() {
    super('No podés asignar un rol con más permisos que los tuyos')
  }
}
