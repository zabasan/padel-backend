import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The three payment columns are deliberately the SAME three as
 * reservation_payments (efectivo / transferencia / postnet). The cash register
 * report has to add court income and shop income together, and it can only do
 * that without translating if both tables speak the same language.
 *
 * A sale is never deleted, only cancelled: `status = 'cancelled'` plus the
 * reversing stock movements. Voiding a sale must leave a trace.
 *
 * `customer_id` is nullable — the walk-in buying a Gatorade is not a user.
 */
export default class extends BaseSchema {
  protected tableName = 'sales'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users')
      table
        .integer('customer_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.decimal('total', 10, 2).notNullable()
      table.decimal('efectivo', 10, 2).notNullable().defaultTo(0)
      table.decimal('transferencia', 10, 2).notNullable().defaultTo(0)
      table.decimal('postnet', 10, 2).notNullable().defaultTo(0)
      table.enu('status', ['completed', 'cancelled']).notNullable().defaultTo('completed')
      table.string('notes', 500).nullable()
      table.integer('cancelled_by').unsigned().nullable().references('id').inTable('users')
      table.timestamp('cancelled_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true })
      table.index(['created_at'])
      table.index(['status', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
