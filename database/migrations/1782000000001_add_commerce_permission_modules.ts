import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  MODULES,
  ROLE_PERMISSION_MATRIX,
  SEEDED_ROLES,
} from '#database/seed_data/permission_matrix'

const COMMERCE_MODULES = ['products', 'sales'] as const

/**
 * The commerce module's own catalog + matrix seed, exactly as
 * 1781000000001_create_modules_table.ts said it would ship.
 *
 * Module rows must land BEFORE the role_permissions rows: role_permissions.module
 * carries a foreign key onto modules.name.
 *
 * Roles created at runtime through the Roles ABM get no row here on purpose.
 * mergePermissionRows() seeds every catalog module all-false before OR-ing in
 * grants, so a missing row resolves to "denied" — the new modules fail closed
 * for custom roles until an admin grants them explicitly.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const name of COMMERCE_MODULES) {
        const definition = MODULES.find((m) => m.name === name)!
        const existing = await db.from('modules').where('name', name).first()
        if (!existing) {
          await db.table('modules').insert({
            name: definition.name,
            visible_name: definition.visibleName,
            created_at: new Date(),
            updated_at: new Date(),
          })
        }
      }

      const roles = await db.from('roles').select('id', 'name')
      const roleIdByName = new Map(roles.map((r) => [r.name, r.id]))

      for (const roleName of SEEDED_ROLES) {
        const roleId = roleIdByName.get(roleName)
        if (!roleId) continue
        for (const moduleName of COMMERCE_MODULES) {
          const perms = ROLE_PERMISSION_MATRIX[roleName][moduleName]
          const existing = await db
            .from('role_permissions')
            .where('role_id', roleId)
            .where('module', moduleName)
            .first()
          if (!existing) {
            await db.table('role_permissions').insert({
              role_id: roleId,
              module: moduleName,
              view: perms.view,
              create: perms.create,
              update: perms.update,
              erase: perms.erase,
              created_at: new Date(),
              updated_at: new Date(),
            })
          }
        }
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      // role_permissions first — the FK onto modules.name is RESTRICT.
      await db
        .from('role_permissions')
        .whereIn('module', [...COMMERCE_MODULES])
        .delete()
      await db
        .from('users_permissions')
        .whereIn('module', [...COMMERCE_MODULES])
        .delete()
      await db
        .from('modules')
        .whereIn('name', [...COMMERCE_MODULES])
        .delete()
    })
  }
}
