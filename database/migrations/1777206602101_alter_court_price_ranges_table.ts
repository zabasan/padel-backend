import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'court_price_ranges'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_peak_hour').defaultTo(false).notNullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_peak_hour')
    })
  }
}