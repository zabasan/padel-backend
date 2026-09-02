import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La seña por defecto de UNA cancha. Pádel, fútbol 5 y fútbol 8 no cobran el mismo
 * porcentaje, y hasta ahora el único número disponible era el global de Ajustes
 * (`defaultDepositPercentage`), que había que corregir a mano en cada reserva.
 *
 * NULLABLE a propósito, y sin default: null significa "esta cancha no define nada, usá
 * la config global". Un 0 guardado NO es lo mismo — es "esta cancha no lleva seña", una
 * decisión explícita que tiene que poder sobrescribir un global mayor a cero. Por eso la
 * ausencia no se puede escribir como 0 (ver `no-deposit-is-not-no-charge`).
 *
 * decimal(5,2) para espejar la precisión de `reservations.deposit_percentage`.
 */
export default class extends BaseSchema {
  protected tableName = 'courts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('deposit_percentage', 5, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('deposit_percentage')
    })
  }
}
