import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Las categorías de gasto son DATOS, no un enum — igual que product_categories.
 * "Servicios / Limpieza / Mantenimiento" es donde arranca el complejo, nunca donde
 * termina, y las estadísticas agrupan por esta tabla.
 *
 * unique(['name', 'deleted_at']) sigue la misma convención NULL-distinct que
 * roles.name y product_categories: a lo sumo UNA categoría viva por nombre, las
 * retiradas conservan su fila para que los gastos históricos sigan teniendo nombre.
 */
export default class extends BaseSchema {
  protected tableName = 'expense_categories'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name', 80).notNullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.unique(['name', 'deleted_at'])
    })

    this.defer(async (db) => {
      const seeds = ['Servicios', 'Limpieza', 'Mantenimiento', 'Insumos', 'Impuestos', 'Sueldos']
      for (const name of seeds) {
        const existing = await db.from(this.tableName).where('name', name).first()
        if (!existing) {
          await db.table(this.tableName).insert({
            name,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          })
        }
      }
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
