import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * El total de fajos retirados en el turno, CONGELADO al cerrar, junto a las seis
 * columnas `in_*` / `out_*` que ya se congelan.
 *
 * Va aparte de esas seis a propósito: un fajo no es una salida de plata del complejo
 * (ver la migración 1785000000001). Sumarlo a `out_efectivo` haría que el historial
 * mostrara como gasto lo que fue un traslado.
 *
 * Y hace falta guardarlo, no solo derivarlo: la tarjeta colapsada del historial calcula
 * el efectivo esperado a partir de estas columnas congeladas, no de los movimientos.
 * Sin esta columna el esperado de la tarjeta contradiría al del detalle, que sí vuelve
 * a derivar los movimientos — y dos cifras distintas para el mismo arqueo es peor que
 * no mostrar ninguna.
 *
 * Default 0 y no nullable: los cierres anteriores a los fajos retiraron cero fajos.
 * Eso es un dato correcto, no un dato faltante.
 */
export default class extends BaseSchema {
  protected tableName = 'cash_sessions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('bundles_efectivo', 10, 2).notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('bundles_efectivo')
    })
  }
}
