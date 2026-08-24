import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Cada movimiento de plata dice A QUÉ SESIÓN DE CAJA pertenece, explícitamente.
 *
 * La primera versión de este módulo derivaba los movimientos de un turno por ventana de
 * tiempo — `created_at` entre `opened_at` y `closed_at` — apoyándose en el invariante de
 * sesión única. Era más barato: cero columnas, cero write-paths tocados. No funciona, y
 * la razón es concreta y medible: **Lucid escribe los timestamps truncados al segundo**
 * (los valores guardados terminan todos en `.000`, incluso con la columna en
 * `timestamp(3)`). Evento y borde de ventana caen los dos en el segundo entero, así que
 * un cobro registrado en el mismo segundo en que se cerró el turno da
 * `created_at < closed_at` = falso: se cae de su propio turno y aparece en el siguiente.
 *
 * Con granularidad de segundo NINGUNA regla basada en tiempo es a la vez exacta y
 * consistente. O pierde movimientos en el borde, o los cuenta en dos turnos, o el
 * arqueo congelado termina contradiciendo al historial que lo vuelve a derivar. Y el
 * arqueo es la única cifra del sistema que no puede estar "casi bien".
 *
 * Por eso la atribución pasa a ser un dato y no un cálculo. Dos columnas por tabla,
 * porque un movimiento y su reverso ocurren en turnos DISTINTOS: el cobro entra en el
 * turno en que se cobró, la devolución sale del turno en que se devolvió.
 *
 * Todas nullable: las filas anteriores a este módulo no pertenecen a ninguna sesión
 * porque no había sesiones, y eso es la verdad, no un dato faltante.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('reservation_payments', (table) => {
      table
        .integer('cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')
      table
        .integer('reverted_in_cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')
      table.index(['cash_session_id'])
      table.index(['reverted_in_cash_session_id'])
    })

    this.schema.alterTable('sales', (table) => {
      table
        .integer('cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')
      table
        .integer('cancelled_in_cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')
      table.index(['cash_session_id'])
      table.index(['cancelled_in_cash_session_id'])
    })

    this.schema.alterTable('expenses', (table) => {
      table
        .integer('cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')
      table
        .integer('cancelled_in_cash_session_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('cash_sessions')
        .onDelete('SET NULL')
      table.index(['cash_session_id'])
      table.index(['cancelled_in_cash_session_id'])
    })
  }

  async down() {
    for (const tableName of ['reservation_payments', 'sales', 'expenses'] as const) {
      const second =
        tableName === 'reservation_payments'
          ? 'reverted_in_cash_session_id'
          : 'cancelled_in_cash_session_id'
      this.schema.alterTable(tableName, (table) => {
        table.dropForeign(['cash_session_id'])
        table.dropForeign([second])
        table.dropIndex(['cash_session_id'])
        table.dropIndex([second])
        table.dropColumn('cash_session_id')
        table.dropColumn(second)
      })
    }
  }
}
