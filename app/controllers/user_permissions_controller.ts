import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'
import {
  getRolePermissionGrid,
  getUserPermissionGrid,
  mergePermissionRows,
  resolvePermissionsForUser,
  setUserPermission,
  type ModulePermissions,
} from '#services/permissions'
import { MODULE_NAMES } from '#database/seed_data/permission_matrix'

const EMPTY: ModulePermissions = { view: false, create: false, update: false, erase: false }

const permsSchema = vine.object({
  view: vine.boolean(),
  create: vine.boolean(),
  update: vine.boolean(),
  erase: vine.boolean(),
})

const updatePermissionsValidator = vine.compile(
  vine.object({
    grid: vine.record(permsSchema),
  })
)

export default class UserPermissionsController {
  async show({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)

    const [roleGrid, userGrid, effective] = await Promise.all([
      user.roleId !== null
        ? getRolePermissionGrid(user.roleId)
        : Promise.resolve(mergePermissionRows(MODULE_NAMES, [], [])),
      getUserPermissionGrid(user.id),
      resolvePermissionsForUser(user),
    ])

    return response.ok({ roleGrid, userGrid, effective })
  }

  async update({ params, request, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const data = await request.validateUsing(updatePermissionsValidator)

    for (const moduleName of MODULE_NAMES) {
      const perms = data.grid[moduleName] ?? EMPTY
      await setUserPermission(user.id, moduleName, perms)
    }

    const [roleGrid, userGrid, effective] = await Promise.all([
      user.roleId !== null
        ? getRolePermissionGrid(user.roleId)
        : Promise.resolve(mergePermissionRows(MODULE_NAMES, [], [])),
      getUserPermissionGrid(user.id),
      resolvePermissionsForUser(user),
    ])

    return response.ok({ roleGrid, userGrid, effective })
  }
}
