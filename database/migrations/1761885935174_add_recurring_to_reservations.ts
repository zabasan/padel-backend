import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_recurring').defaultTo(false).notNullable()
      table.date('hidden_until').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_recurring')
      table.dropColumn('hidden_until')
    })
  }
}
