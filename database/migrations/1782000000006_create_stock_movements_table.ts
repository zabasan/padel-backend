import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The inventory ledger. `products.stock` is a running total for speed; THIS is
 * the record of how it got there, and the two are written in the same
 * transaction so they can never disagree.
 *
 * `quantity` is a SIGNED delta (+5 restock, -2 sale). `type` only says why:
 *   in         restock / purchase        (+)
 *   out        breakage, internal use    (-)
 *   adjustment physical count correction (either sign)
 *   sale       sold at the POS           (-)
 *   return     sale cancelled            (+)
 *
 * `stock_after` is stored, not recomputed. An audit trail that has to be
 * replayed from the beginning to be read is not an audit trail.
 */
export default class extends BaseSchema {
  protected tableName = 'stock_movements'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table.enu('type', ['in', 'out', 'adjustment', 'sale', 'return']).notNullable()
      table.integer('quantity').notNullable()
      table.integer('stock_before').notNullable()
      table.integer('stock_after').notNullable()
      table.string('reason', 300).nullable()
      table
        .integer('sale_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('sales')
        .onDelete('SET NULL')
      table.integer('performed_by').unsigned().notNullable().references('id').inTable('users')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['product_id', 'created_at'])
      table.index(['sale_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
