import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Drop the single payment_method column added in previous migration
    this.schema.alterTable('reservations', (table) => {
      table.dropColumn('payment_method')
    })

    // Create dedicated payments table — one row per payment event
    this.schema.createTable('reservation_payments', (table) => {
      table.increments('id')
      table
        .integer('reservation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('reservations')
        .onDelete('CASCADE')
      table.enu('type', ['deposit', 'total']).notNullable()
      table.decimal('efectivo', 10, 2).notNullable().defaultTo(0)
      table.decimal('transferencia', 10, 2).notNullable().defaultTo(0)
      table.decimal('postnet', 10, 2).notNullable().defaultTo(0)
      table.decimal('total', 10, 2).notNullable()
      table.integer('paid_by').unsigned().notNullable()
      table.string('receipt', 5000).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable('reservation_payments')
    this.schema.alterTable('reservations', (table) => {
      table.string('payment_method', 20).nullable()
    })
  }
}
