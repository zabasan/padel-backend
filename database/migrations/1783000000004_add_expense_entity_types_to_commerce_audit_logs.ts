import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Extiende el enum de commerce_audit_logs.entity_type con 'expense' y
 * 'expense_category'.
 *
 * Los gastos NO tienen su propia tabla de auditoría a propósito. La pregunta que
 * responde este log es "quién tocó la plata hoy", y productos, ventas y gastos son
 * la misma tarde y la misma pantalla: una cuarta tabla serían un endpoint más y una
 * pestaña más para reconstruir un solo turno. El nombre `commerce_audit_logs` queda
 * como está — renombrar una tabla en producción por un matiz de vocabulario es puro
 * ruido; lo que la tabla es hoy es el log de operaciones de plata del complejo.
 *
 * MODIFY COLUMN crudo porque la app corre solo sobre MySQL (config/database.ts tiene
 * una única conexión, mysql2) y knex no sabe alterar un ENUM in place.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(
      `ALTER TABLE commerce_audit_logs
       MODIFY COLUMN entity_type
       ENUM('product','category','sale','expense','expense_category') NOT NULL`
    )
  }

  async down() {
    this.defer(async (db) => {
      // Las filas de gasto tienen que irse antes de encoger el enum, o el ALTER las
      // convierte en '' silenciosamente.
      await db
        .from('commerce_audit_logs')
        .whereIn('entity_type', ['expense', 'expense_category'])
        .delete()
      await db.rawQuery(
        `ALTER TABLE commerce_audit_logs
         MODIFY COLUMN entity_type ENUM('product','category','sale') NOT NULL`
      )
    })
  }
}
