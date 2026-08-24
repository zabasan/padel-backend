import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Un pago revertido se ANULA, ya no se borra.
 *
 * Hasta acá `revertPayment` hacía un DELETE físico, y `reservation_payments` era la
 * única tabla de plata que se borraba: `sales` y `expenses` se anulan
 * (status='cancelled' + cancelled_by/at). La migración de `expenses` dice por qué:
 * "un gasto que desaparece sin dejar rastro es exactamente cómo una caja se
 * descuadra en silencio".
 *
 * El caso concreto que rompía: un pago cobrado en un turno y revertido en OTRO. La
 * plata sale del cajón en el segundo turno, pero al borrarse la fila no quedaba nada
 * que lo dijera, así que el arqueo de ese turno contaba efectivo que ya no estaba.
 * Con `reverted_at` la reversión es un hecho fechado y el cierre de caja la puede
 * imputar al turno en que ocurrió.
 *
 * Toda lectura de pagos vigentes filtra `reverted_at IS NULL`. La relación
 * Reservation.payments lo hace en su `onQuery` para que ningún preload nuevo se lo
 * pueda olvidar.
 *
 * `paid_by` venía sin FK y sin índice (a diferencia de sales.user_id y
 * expenses.created_by). El índice (paid_by, created_at) se agrega acá porque es
 * exactamente el que necesita la consulta del turno: "los movimientos de esta
 * persona en esta ventana". La FK se deja afuera a propósito: agregarla ahora sobre
 * datos existentes puede fallar si algún pago quedó apuntando a un usuario borrado,
 * y no es lo que este cambio necesita.
 */
export default class extends BaseSchema {
  protected tableName = 'reservation_payments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('reverted_at', { useTz: true }).nullable()
      table
        .integer('reverted_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.index(['reverted_at'])
      table.index(['paid_by', 'created_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['paid_by', 'created_at'])
      table.dropIndex(['reverted_at'])
      table.dropForeign(['reverted_by'])
      table.dropColumn('reverted_by')
      table.dropColumn('reverted_at')
    })
  }
}
