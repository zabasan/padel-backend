import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Role from '#models/role'
import { DateTime } from 'luxon'
import {
  listRolesWithGrids,
  getRolePermissionGrid,
  setRolePermission,
  type ModulePermissions,
  type PermissionMap,
} from '#services/permissions'
import { MODULES, MODULE_NAMES, SEEDED_ROLES } from '#database/seed_data/permission_matrix'
import db from '@adonisjs/lucid/services/db'

const EMPTY: ModulePermissions = { view: false, create: false, update: false, erase: false }

const permsSchema = vine.object({
  view: vine.boolean(),
  create: vine.boolean(),
  update: vine.boolean(),
  erase: vine.boolean(),
})

const createRoleValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(50),
    description: vine.string().trim().maxLength(255).optional().nullable(),
    grid: vine.record(permsSchema).optional(),
  })
)

const updateRoleValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(50).optional(),
    description: vine.string().trim().maxLength(255).optional().nullable(),
    grid: vine.record(permsSchema).optional(),
  })
)

async function applyGrid(roleId: number, grid: PermissionMap | undefined) {
  for (const moduleName of MODULE_NAMES) {
    const perms = grid?.[moduleName] ?? EMPTY
    await setRolePermission(roleId, moduleName, perms)
  }
}

function countGrantsAndModules(grid: PermissionMap): {
  permissionsCount: number
  modulesCount: number
} {
  let permissionsCount = 0
  let modulesCount = 0
  for (const moduleName of Object.keys(grid)) {
    const perms = grid[moduleName]
    const granted = [perms.view, perms.create, perms.update, perms.erase].filter(Boolean).length
    if (granted > 0) modulesCount += 1
    permissionsCount += granted
  }
  return { permissionsCount, modulesCount }
}

export default class RolesController {
  async index({ response }: HttpContext) {
    const roles = await listRolesWithGrids()
    return response.ok(
      roles.map((role) => ({
        ...role,
        ...countGrantsAndModules(role.grid),
      }))
    )
  }

  async show({ params, response }: HttpContext) {
    const role = await Role.query().where('id', params.id).whereNull('deletedAt').firstOrFail()
    const grid = await getRolePermissionGrid(role.id)
    return response.ok({
      id: role.id,
      name: role.name,
      description: role.description,
      grid,
    })
  }

  async store({ request, response }: HttpContext) {
    const data = await request.validateUsing(createRoleValidator)

    const existing = await Role.query().where('name', data.name).whereNull('deletedAt').first()
    if (existing) {
      return response.conflict({ message: `Ya existe un rol con el nombre "${data.name}"` })
    }

    const role = await Role.create({ name: data.name, description: data.description ?? null })
    await applyGrid(role.id, data.grid)

    const grid = await getRolePermissionGrid(role.id)
    return response.created({
      id: role.id,
      name: role.name,
      description: role.description,
      grid,
    })
  }

  async update({ params, request, auth, response }: HttpContext) {
    const performer = auth.user!
    const role = await Role.query().where('id', params.id).whereNull('deletedAt').firstOrFail()
    const data = await request.validateUsing(updateRoleValidator)

    if (data.name !== undefined && data.name !== role.name) {
      const existing = await Role.query()
        .where('name', data.name)
        .whereNull('deletedAt')
        .whereNot('id', role.id)
        .first()
      if (existing) {
        return response.conflict({ message: `Ya existe un rol con el nombre "${data.name}"` })
      }
    }

    // Anti-auto-lockout: you may never strip roles.view/roles.update from the
    // role you yourself hold — that would lock every admin (including you)
    // out of this very screen, with no other way back in.
    if (performer.roleId === role.id && data.grid) {
      const rolesPerms = data.grid.roles ?? EMPTY
      if (!rolesPerms.view || !rolesPerms.update) {
        return response.forbidden({
          message: 'No podés quitarte permisos de administración de roles a vos mismo',
        })
      }
    }

    if (data.name !== undefined) role.name = data.name
    if (data.description !== undefined) role.description = data.description
    await role.save()

    if (data.grid) {
      await applyGrid(role.id, data.grid)
    }

    const grid = await getRolePermissionGrid(role.id)
    return response.ok({
      id: role.id,
      name: role.name,
      description: role.description,
      grid,
    })
  }

  async destroy({ params, response }: HttpContext) {
    const role = await Role.query().where('id', params.id).whereNull('deletedAt').firstOrFail()

    if ((SEEDED_ROLES as readonly string[]).includes(role.name)) {
      return response.forbidden({
        message: 'Los roles predefinidos del sistema no se pueden eliminar',
      })
    }

    const usersCountRows = await db.from('users').where('role_id', role.id).count('* as total')
    const usersCount = Number(usersCountRows[0]?.total ?? 0)
    if (usersCount > 0) {
      return response.conflict({
        message: `No se puede eliminar: ${usersCount} usuario(s) tienen este rol asignado`,
        usersCount,
      })
    }

    // Soft delete ONLY — a hard DELETE would cascade the role's permission rows
    // away silently; setting deletedAt goes through the normal @afterSave
    // hook, which invalidates role_sync's cache correctly.
    role.deletedAt = DateTime.now()
    await role.save()

    return response.ok({ message: 'Rol eliminado correctamente' })
  }

  async modules({ response }: HttpContext) {
    return response.ok(MODULES)
  }
}
