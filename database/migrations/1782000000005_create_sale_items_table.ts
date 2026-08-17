import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `product_name` and `unit_price` are SNAPSHOTS, not joins. A sale from March
 * has to keep reading as it did in March even after the product is renamed,
 * repriced, or retired — the same reason reservations freeze `total_price`.
 *
 * The FK onto products stays anyway (SET NULL) so the ticket can still link
 * through to a live product when there is one.
 */
export default class extends BaseSchema {
  protected tableName = 'sale_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('sale_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('sales')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('products')
        .onDelete('SET NULL')
      table.string('product_name', 120).notNullable()
      table.decimal('unit_price', 10, 2).notNullable()
      table.decimal('unit_cost', 10, 2).notNullable().defaultTo(0)
      table.integer('quantity').notNullable()
      table.decimal('subtotal', 10, 2).notNullable()
      table.timestamp('created_at', { useTz: true })
      table.index(['sale_id'])
      table.index(['product_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
