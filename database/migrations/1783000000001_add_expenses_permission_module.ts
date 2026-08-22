import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  MODULES,
  ROLE_PERMISSION_MATRIX,
  SEEDED_ROLES,
} from '#database/seed_data/permission_matrix'

const EXPENSE_MODULES = ['expenses'] as const

/**
 * `expenses` — gastos de las instalaciones (servicios, limpieza, mantenimiento,
 * insumos). Módulo propio, separado de `sales`: cobrar plata y sacar plata son
 * trabajos distintos, y el gasto es lo único de la app que BAJA el resultado del
 * período, así que quién puede cargarlo es una decisión aparte.
 *
 * Las filas de `modules` van ANTES que las de `role_permissions`:
 * role_permissions.module tiene una foreign key sobre modules.name.
 *
 * Sembrado para admin y supervisor. `worker` queda en cero a propósito, igual que
 * cualquier módulo nuevo: mergePermissionRows() siembra el catálogo todo-en-false
 * antes de OR-ear los grants, así que la ausencia de fila resuelve "denegado" y el
 * módulo falla cerrado hasta que un admin lo conceda desde el ABM de Roles.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const name of EXPENSE_MODULES) {
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
        for (const moduleName of EXPENSE_MODULES) {
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
      // role_permissions primero — la FK sobre modules.name es RESTRICT.
      await db
        .from('role_permissions')
        .whereIn('module', [...EXPENSE_MODULES])
        .delete()
      await db
        .from('users_permissions')
        .whereIn('module', [...EXPENSE_MODULES])
        .delete()
      await db
        .from('modules')
        .whereIn('name', [...EXPENSE_MODULES])
        .delete()
    })
  }
}
