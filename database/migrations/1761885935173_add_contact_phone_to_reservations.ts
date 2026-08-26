import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  protected tableName = 'reservations'
  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('contact_phone').nullable()
      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
  }
  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('contact_phone')
      table.dropColumn('customer_id')
    })
  }
}
