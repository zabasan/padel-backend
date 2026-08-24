import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Precisión de milisegundos en los timestamps que fechan un movimiento de plata.
 *
 * ADVERTENCIA, y es la parte importante: esto NO alcanza para atribuir un movimiento a
 * un turno. Se hizo con esa intención y no funcionó — Lucid escribe los timestamps
 * truncados al segundo, así que los valores guardados terminan en `.000` igual, incluso
 * con la columna en `timestamp(3)`. La atribución quedó resuelta con columnas
 * `cash_session_id` explícitas; ver la migración 1784000000005, que explica por qué
 * ninguna regla basada en tiempo servía.
 *
 * La migración se conserva porque subir la precisión sigue siendo correcto por sí mismo:
 * el día que Lucid (o un insert a mano) escriba fraccionales, el orden entre dos
 * movimientos del mismo segundo deja de ser arbitrario, y la columna ya está lista. Es
 * compatible hacia atrás: los valores existentes quedan con `.000` y toda comparación
 * que ya funcionaba sigue funcionando.
 *
 * Las seis columnas son las que fechan un hecho de caja:
 *   reservation_payments.created_at   (cobro)
 *   reservation_payments.reverted_at  (devolución)
 *   sales.created_at                  (venta)
 *   sales.cancelled_at                (anulación de venta)
 *   expenses.created_at               (gasto — created_at, NO expense_date)
 *   expenses.cancelled_at             (gasto anulado)
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('reservation_payments', (table) => {
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().alter()
      table.timestamp('reverted_at', { useTz: true, precision: 3 }).nullable().alter()
    })
    this.schema.alterTable('sales', (table) => {
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().alter()
      table.timestamp('cancelled_at', { useTz: true, precision: 3 }).nullable().alter()
    })
    this.schema.alterTable('expenses', (table) => {
      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable().alter()
      table.timestamp('cancelled_at', { useTz: true, precision: 3 }).nullable().alter()
    })
  }

  async down() {
    this.schema.alterTable('reservation_payments', (table) => {
      table.timestamp('created_at', { useTz: true }).notNullable().alter()
      table.timestamp('reverted_at', { useTz: true }).nullable().alter()
    })
    this.schema.alterTable('sales', (table) => {
      table.timestamp('created_at', { useTz: true }).notNullable().alter()
      table.timestamp('cancelled_at', { useTz: true }).nullable().alter()
    })
    this.schema.alterTable('expenses', (table) => {
      table.timestamp('created_at', { useTz: true }).notNullable().alter()
      table.timestamp('cancelled_at', { useTz: true }).nullable().alter()
    })
  }
}
