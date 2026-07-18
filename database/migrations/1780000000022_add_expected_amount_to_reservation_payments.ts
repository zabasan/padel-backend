import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('reservation_payments', (table) => {
      // Base price expected for the occurrence this payment covers, frozen at payment time.
      // Used to compute the series carry balance = Σ(total) − Σ(expected_amount) for recurring
      // total payments. Null for non-recurring payments and for payments created before this
      // migration (excluded from the balance so they never create phantom debt/credit).
      table.decimal('expected_amount', 10, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable('reservation_payments', (table) => {
      table.dropColumn('expected_amount')
    })
  }
}
