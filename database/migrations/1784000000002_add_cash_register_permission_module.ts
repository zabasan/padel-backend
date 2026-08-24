import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  MODULES,
  ROLE_PERMISSION_MATRIX,
  SEEDED_ROLES,
} from '#database/seed_data/permission_matrix'

const CASH_MODULES = ['cash_register'] as const

/**
 * `cash_register` — la caja del complejo: abrirla al empezar el turno, cerrarla al
 * terminarlo, y ver el arqueo.
 *
 * Tres verbos: `view` (ver el turno y el historial), `create` (ABRIR) y `update`
 * (CERRAR). Sin `erase`, porque un cierre de caja es un hecho y no se borra.
 *
 * Las filas de `modules` van ANTES que las de `role_permissions`:
 * role_permissions.module tiene una foreign key sobre modules.name.
 *
 * A diferencia de todo otro módulo nuevo, `worker` arranca CON el permiso. La regla de
 * "un módulo nuevo falla cerrado" existe para que nadie gane acceso sin que se decida;
 * acá la decisión ya está tomada y es el punto de la función: los chicos del mostrador
 * son quienes abren y cierran la caja de su turno. Sembrarlo en cero dejaría la
 * funcionalidad invisible justo para quien la va a usar.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const name of CASH_MODULES) {
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
        for (const moduleName of CASH_MODULES) {
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
        .whereIn('module', [...CASH_MODULES])
        .delete()
      await db
        .from('users_permissions')
        .whereIn('module', [...CASH_MODULES])
        .delete()
      await db
        .from('modules')
        .whereIn('name', [...CASH_MODULES])
        .delete()
    })
  }
}
