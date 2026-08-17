import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `role_id` is NULLABLE on purpose: application code running mid-deploy still
 * inserts users without it, and a NOT NULL column would 500 every signup
 * during that window. Tighten to NOT NULL in a later migration once the
 * `users.role` <-> `roles.name` sync hook has shipped everywhere.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('role_id')
        .unsigned()
        .nullable()
        .after('role')
        .references('id')
        .inTable('roles')
        .onDelete('RESTRICT')
      table.index(['role_id'])
    })

    this.defer(async (db) => {
      const roles = await db.from('roles').select('id', 'name')
      const roleIdByName = new Map(roles.map((r) => [r.name, r.id]))
      for (const [name, id] of roleIdByName) {
        await db.from('users').where('role', name).update({ role_id: id })
      }
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropForeign('role_id')
      table.dropIndex(['role_id'])
      table.dropColumn('role_id')
    })
  }
}
