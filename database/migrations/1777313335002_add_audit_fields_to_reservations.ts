import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('confirmed_at').nullable()
      table.integer('confirmed_by').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      table.timestamp('cancelled_at').nullable()
      table.integer('cancelled_by').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      table.timestamp('deposit_paid_at').nullable()
      table.integer('deposit_paid_by').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
      table.timestamp('total_paid_at').nullable()
      table.integer('total_paid_by').unsigned().references('id').inTable('users').onDelete('SET NULL').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('confirmed_at')
      table.dropColumn('confirmed_by')
      table.dropColumn('cancelled_at')
      table.dropColumn('cancelled_by')
      table.dropColumn('deposit_paid_at')
      table.dropColumn('deposit_paid_by')
      table.dropColumn('total_paid_at')
      table.dropColumn('total_paid_by')
    })
  }
}
