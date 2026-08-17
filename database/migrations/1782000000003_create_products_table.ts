import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `price` is the selling price; `cost` is what the complex paid for it, kept so
 * margin is reportable later. Both decimal(10,2) to match every other money
 * column in the schema (reservations.total_price, reservation_payments.*).
 *
 * `track_stock = false` covers items with no meaningful inventory (a court-side
 * service, an on-the-spot racket restring). Those never hit the stock guard and
 * never appear in the low-stock list.
 *
 * Products are soft-deleted: sale_items snapshot name and price, but the FK
 * still points here, and the product detail of an old sale must stay openable.
 */
export default class extends BaseSchema {
  protected tableName = 'products'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('category_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('product_categories')
        .onDelete('SET NULL')
      table.string('name', 120).notNullable()
      table.string('sku', 60).nullable()
      table.decimal('price', 10, 2).notNullable().defaultTo(0)
      table.decimal('cost', 10, 2).notNullable().defaultTo(0)
      table.integer('stock').notNullable().defaultTo(0)
      table.integer('min_stock').notNullable().defaultTo(0)
      table.boolean('track_stock').notNullable().defaultTo(true)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.unique(['sku', 'deleted_at'])
      table.index(['category_id', 'deleted_at'])
      table.index(['is_active', 'deleted_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
