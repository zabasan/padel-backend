import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Per-user extra permissions. Empty by design — no backfill. Resolution is a
 * pure union with role_permissions (see app/services/permissions.ts): a user
 * row only ADDS, it can never revoke a role grant.
 */
export default class extends BaseSchema {
  protected tableName = 'users_permissions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('module', 60).notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.boolean('view').notNullable().defaultTo(false)
      table.boolean('create').notNullable().defaultTo(false)
      table.boolean('update').notNullable().defaultTo(false)
      table.boolean('erase').notNullable().defaultTo(false)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.unique(['user_id', 'module', 'deleted_at'])
      table.index(['user_id', 'deleted_at'])
      table.foreign('module').references('name').inTable('modules').onDelete('RESTRICT')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
