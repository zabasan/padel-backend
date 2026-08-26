import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('court_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('courts')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.dateTime('start_time').notNullable()
      table.dateTime('end_time').notNullable()
      table.enum('status', ['pending', 'confirmed', 'cancelled']).notNullable().defaultTo('pending')
      table.text('notes').nullable()
      table.decimal('total_price', 10, 2).notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
