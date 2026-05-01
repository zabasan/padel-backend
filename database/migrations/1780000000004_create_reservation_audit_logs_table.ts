import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservation_audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('performed_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL')
      table.integer('reservation_id').unsigned().notNullable().references('id').inTable('reservations').onDelete('CASCADE')
      table.string('field').notNullable()
      table.text('old_value').nullable()
      table.text('new_value').nullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
