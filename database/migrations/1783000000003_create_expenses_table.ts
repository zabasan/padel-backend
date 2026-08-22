import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Un gasto de las instalaciones: pintura, papel higiénico, la factura de la luz, el
 * servicio de limpieza.
 *
 * Las tres columnas de pago son deliberadamente LAS MISMAS tres que
 * reservation_payments y sales (efectivo / transferencia / postnet). El informe de
 * caja tiene que restar el gasto del ingreso sin traducir nada, y solo puede hacerlo
 * si las tres tablas hablan el mismo idioma. Además importa de verdad: pagar la
 * pintura con la plata del cajón no es lo mismo que pagarla por transferencia.
 *
 * `expense_date` es un DATE (en ART), NO un timestamp, y es distinto de `created_at`:
 * la factura de la luz de ayer se carga hoy y pertenece a ayer. Las estadísticas
 * filtran por `expense_date` por eso mismo — es el día en que la plata salió, que es
 * la pregunta que responde la pantalla. Misma decisión que `occurrence_date` en
 * reservation_payments.
 *
 * Un gasto nunca se borra, se ANULA (`status = 'cancelled'` + cancelled_by/at). Un
 * gasto que desaparece sin dejar rastro es exactamente cómo una caja se descuadra en
 * silencio — misma regla que una venta anulada.
 */
export default class extends BaseSchema {
  protected tableName = 'expenses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('category_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('expense_categories')
        .onDelete('SET NULL')
      table.string('description', 200).notNullable()
      table.string('supplier', 120).nullable()
      table.decimal('amount', 10, 2).notNullable()
      table.decimal('efectivo', 10, 2).notNullable().defaultTo(0)
      table.decimal('transferencia', 10, 2).notNullable().defaultTo(0)
      table.decimal('postnet', 10, 2).notNullable().defaultTo(0)
      table.date('expense_date').notNullable()
      table.string('notes', 500).nullable()
      table.enu('status', ['completed', 'cancelled']).notNullable().defaultTo('completed')
      table.integer('created_by').unsigned().notNullable().references('id').inTable('users')
      table
        .integer('cancelled_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('cancelled_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true })
      table.index(['expense_date'])
      table.index(['status', 'expense_date'])
      table.index(['category_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
