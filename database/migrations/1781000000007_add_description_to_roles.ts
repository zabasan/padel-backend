import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Feeds the roles list search ("Search by name or description" in the
 * reference UI). `Role.name` stays the key AND the label — no `visibleName`
 * needed for roles the way modules have one.
 */
export default class extends BaseSchema {
  protected tableName = 'roles'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('description', 255).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('description')
    })
  }
}
