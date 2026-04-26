import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'courts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('parent_court_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('courts')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('parent_court_id')
    })
  }
}
