import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Un tercer tipo de pago: `debt`, el cobro de la deuda arrastrada de una fija.
 *
 * Va como tipo propio y no reusando `total` porque en todo el sistema un pago
 * `type='total'` significa "esta ocurrencia quedó cobrada", y hay cuatro lugares que se
 * apoyan en eso:
 *
 *   - la guarda de `payTotal` que rechaza cobrar dos veces la misma semana,
 *   - `paidOccurrences` / `totalPaid` por ocurrencia (attachPromoFields),
 *   - `completed_reservations` en las estadísticas,
 *   - `revertPayment`, que descuenta `total_paid_count`.
 *
 * Una fila de deuda con `type='total'` marcaría una semana como paga sin haberla
 * cobrado. Con `debt` los cuatro quedan intactos por construcción: todos filtran
 * `type='total'`.
 *
 * El `down` vuelve al par original, así que solo es reversible si no quedan filas
 * `debt` — que es la semántica correcta: sin el tipo, esos cobros no tienen dónde ir.
 */
export default class extends BaseSchema {
  protected tableName = 'reservation_payments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.enu('type', ['deposit', 'total', 'debt']).notNullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.enu('type', ['deposit', 'total']).notNullable().alter()
    })
  }
}
