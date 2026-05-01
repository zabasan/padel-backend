import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'court_price_ranges'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('price_60_min', 10, 2).nullable()
      table.decimal('price_90_min', 10, 2).nullable()
      table.decimal('price_120_min', 10, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('price_60_min')
      table.dropColumn('price_90_min')
      table.dropColumn('price_120_min')
    })
  }
}
