import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Interruptor de la promo de partidos consecutivos POR RESERVA.
 *
 * La promo (`recurringPromoGames` / `recurringPromoFreeGames`) se configura una sola vez
 * para todo el complejo, así que hasta ahora una fija no podía quedar afuera: o la promo
 * estaba prendida para todas, o para ninguna. Este flag agrega el tercer estado que faltaba,
 * "esta serie no participa", sin tocar la configuración global.
 *
 * NOT NULL con default `true`: la ausencia de decisión es participar, que es exactamente
 * cómo se comportaban todas las reservas antes de esta columna. Por eso el default también
 * sirve de backfill — las filas existentes quedan en `true` sin un UPDATE aparte.
 *
 * Solo tiene efecto sobre reservas recurrentes; en una simple la columna es inerte.
 */
export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('promo_enabled').notNullable().defaultTo(true)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('promo_enabled')
    })
  }
}
