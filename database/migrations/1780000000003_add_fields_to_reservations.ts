import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('discount_percentage', 5, 2).notNullable().defaultTo(0)
      table.integer('consecutive_games').notNullable().defaultTo(0)
      table.decimal('custom_price', 10, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('discount_percentage')
      table.dropColumn('consecutive_games')
      table.dropColumn('custom_price')
    })
  }
}
