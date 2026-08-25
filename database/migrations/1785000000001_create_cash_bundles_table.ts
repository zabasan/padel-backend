import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Un FAJO: un retiro de efectivo del cajón durante un turno. N por turno, de montos
 * distintos.
 *
 * Un fajo NO es un egreso del complejo, es un TRASLADO — y esa distinción es la que
 * gobierna todo el módulo. Un gasto saca la plata del negocio; un fajo la mueve de
 * lugar. Por eso no entra a las columnas `in_*` / `out_*` del arqueo junto con gastos y
 * devoluciones: si lo hiciera, el número del turno caería a casi cero apenas se retira
 * la recaudación, diciendo que el turno no facturó nada, y el historial mostraría
 * cientos de miles de "salidas" que nadie gastó.
 *
 * Lo que el fajo SÍ hace es bajar el efectivo esperado en el cajón:
 *
 *   esperado = fondo + efectivo cobrado − efectivo pagado − fajos retirados
 *
 * Sin esto el conteo del cierre da siempre de menos y la diferencia queda
 * permanentemente en rojo por un movimiento que el sistema no conoce.
 *
 * `amount` sin desglose de método, a diferencia de las otras tres tablas de plata: un
 * fajo es un fajo de billetes. No existe un fajo por transferencia.
 *
 * `cash_session_id` es NOT NULL, y ahí se aparta del resto de las tablas de plata. En
 * `reservation_payments`, `sales` y `expenses` la columna es nullable porque hay filas
 * anteriores al módulo de caja que no pertenecen a ninguna sesión — y eso es la verdad,
 * no un dato faltante. Acá no hay historia previa: un fajo nace dentro de un turno o no
 * nace. Ver la migración 1784000000005 para por qué la atribución es un dato estampado
 * y no un cálculo sobre timestamps.
 *
 * Un fajo se ANULA, nunca se borra (`status` + cancelled_by/at), misma regla que una
 * venta y un gasto. Un fajo mal tipeado — $500.000 en lugar de $50.000 — envenena el
 * arqueo para siempre si no hay forma de revertirlo, y una fila de plata que desaparece
 * sin dejar rastro es exactamente cómo una caja se descuadra en silencio. La anulación
 * lleva su propia sesión porque devuelve el efectivo al cajón del turno en que se anuló,
 * que puede no ser el turno en que se retiró.
 */
export default class extends BaseSchema {
  protected tableName = 'cash_bundles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('cash_session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('cash_sessions')

      table.decimal('amount', 10, 2).notNullable()
      table.string('notes', 200).nullable()

      table.enum('status', ['completed', 'cancelled']).notNullable().defaultTo('completed')

      table.integer('created_by').unsigned().notNullable().references('id').inTable('users')

      table
        .integer('cancelled_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // Precisión 3 como el resto de los timestamps que fechan un hecho de caja,
      // ver la migración 1784000000004.
      table.timestamp('cancelled_at', { useTz: true, precision: 3 }).nullable()
      table
        .integer('cancelled_in_cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')

      table.timestamp('created_at', { useTz: true, precision: 3 }).notNullable()
      table.timestamp('updated_at', { useTz: true, precision: 3 })

      table.index(['cash_session_id'])
      table.index(['cancelled_in_cash_session_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
