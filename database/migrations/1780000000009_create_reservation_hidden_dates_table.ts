import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservation_hidden_dates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('reservation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('reservations')
        .onDelete('CASCADE')
      table.date('hidden_date').notNullable()
      table.unique(['reservation_id', 'hidden_date'])
      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
