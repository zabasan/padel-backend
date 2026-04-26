import { BaseSchema } from '@adonisjs/lucid/schema'
export default class extends BaseSchema {
  protected tableName = 'court_price_ranges'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('court_id').unsigned().notNullable().references('id').inTable('courts').onDelete('CASCADE')
      table.integer('start_hour').notNullable()  // 0-23
      table.integer('end_hour').notNullable()    // 1-24 (24 = midnight/00:00)
      table.decimal('price_per_hour', 10, 2).notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }
  async down() { this.schema.dropTable(this.tableName) }
}
