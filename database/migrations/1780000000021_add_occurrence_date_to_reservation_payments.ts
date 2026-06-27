import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('reservation_payments', (table) => {
      // Date (YYYY-MM-DD) of the specific recurring occurrence this payment covers.
      // Null for non-recurring reservations and for payments created before this migration.
      table.date('occurrence_date').nullable()
    })
  }

  async down() {
    this.schema.alterTable('reservation_payments', (table) => {
      table.dropColumn('occurrence_date')
    })
  }
}
