import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * One audit table for the whole commerce module, not one per entity like
 * user_audit_logs / reservation_audit_logs.
 *
 * The reason is the question it has to answer: "who touched the shop today". Products,
 * categories and sales are one domain and one screen; three tables would mean three endpoints
 * and three tabs to reconstruct a single afternoon.
 *
 * `entity_id` deliberately carries NO foreign key, and `entity_label` snapshots the name. A
 * product is soft-deleted and a category can be retired — the log of who deleted it has to
 * survive the thing it describes, and has to still be readable afterwards.
 */
export default class extends BaseSchema {
  protected tableName = 'commerce_audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('performed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.enu('entity_type', ['product', 'category', 'sale']).notNullable()
      table.integer('entity_id').unsigned().notNullable()
      table.string('entity_label', 150).notNullable()
      table.enu('action', ['create', 'update', 'delete', 'cancel', 'stock']).notNullable()
      table.string('field', 60).nullable()
      table.text('old_value').nullable()
      table.text('new_value').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['created_at'])
      table.index(['entity_type', 'entity_id'])
      table.index(['performed_by'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
