import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  MODULES,
  ROLE_PERMISSION_MATRIX,
  SEEDED_ROLES,
} from '#database/seed_data/permission_matrix'

const OVERRIDE_MODULES = ['reservation_overrides'] as const

/**
 * `reservation_overrides` — authority to book past a business rule that would
 * otherwise reject the reservation. Today that is exactly one rule: the
 * professor hour window (`professorStartHour`/`professorEndHour`), which used to
 * block staff too whenever the reservation's customer happened to be a professor.
 *
 * Module rows must land BEFORE the role_permissions rows: role_permissions.module
 * carries a foreign key onto modules.name.
 *
 * Seeded for admin and supervisor only. Roles created at runtime through the
 * Roles ABM get no row here on purpose: mergePermissionRows() seeds every catalog
 * module all-false before OR-ing in grants, so a missing row resolves to "denied"
 * — the new module fails closed until an admin grants it explicitly.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const name of OVERRIDE_MODULES) {
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
        for (const moduleName of OVERRIDE_MODULES) {
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
        .whereIn('module', [...OVERRIDE_MODULES])
        .delete()
      await db
        .from('users_permissions')
        .whereIn('module', [...OVERRIDE_MODULES])
        .delete()
      await db
        .from('modules')
        .whereIn('name', [...OVERRIDE_MODULES])
        .delete()
    })
  }
}
