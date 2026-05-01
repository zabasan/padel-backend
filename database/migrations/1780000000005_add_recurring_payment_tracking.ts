import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dateTime('last_incremented_at').nullable().defaultTo(null)
      table.integer('total_paid_count').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('last_incremented_at')
      table.dropColumn('total_paid_count')
    })
  }
}
