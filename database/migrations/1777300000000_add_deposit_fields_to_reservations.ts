import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('deposit_percentage', 5, 2).nullable()
      table.boolean('deposit_paid').defaultTo(false).notNullable()
      table.text('deposit_receipt').nullable()
      table.boolean('total_paid').defaultTo(false).notNullable()
      table.text('total_receipt').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('deposit_percentage')
      table.dropColumn('deposit_paid')
      table.dropColumn('deposit_receipt')
      table.dropColumn('total_paid')
      table.dropColumn('total_receipt')
    })
  }
}
