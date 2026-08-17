import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  MODULE_NAMES,
  ROLE_PERMISSION_MATRIX,
  SEEDED_ROLES,
} from '#database/seed_data/permission_matrix'

/**
 * unique(['role_id', 'module', 'deleted_at']) — includes deleted_at for the
 * same NULL-distinct reason as roles.name. Guarantees at most one LIVE row
 * per (role_id, module), which is what makes the union resolver unambiguous.
 *
 * The fourth verb is `erase`, never `delete` — see user_permission.ts for why
 * (LucidRow.delete() collision).
 */
export default class extends BaseSchema {
  protected tableName = 'role_permissions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('module', 60).notNullable()
      table
        .integer('role_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('roles')
        .onDelete('CASCADE')
      table.boolean('view').notNullable().defaultTo(false)
      table.boolean('create').notNullable().defaultTo(false)
      table.boolean('update').notNullable().defaultTo(false)
      table.boolean('erase').notNullable().defaultTo(false)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.unique(['role_id', 'module', 'deleted_at'])
      table.index(['role_id', 'deleted_at'])
      table.foreign('module').references('name').inTable('modules').onDelete('RESTRICT')
    })

    this.defer(async (db) => {
      const roles = await db.from('roles').select('id', 'name')
      const roleIdByName = new Map(roles.map((r) => [r.name, r.id]))

      for (const roleName of SEEDED_ROLES) {
        const roleId = roleIdByName.get(roleName)
        if (!roleId) continue
        const modulePerms = ROLE_PERMISSION_MATRIX[roleName]
        for (const moduleName of MODULE_NAMES) {
          const perms = modulePerms[moduleName]
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
    this.schema.dropTable(this.tableName)
  }
}
