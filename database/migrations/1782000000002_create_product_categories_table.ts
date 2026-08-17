import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Categories are data, not an enum: "Paletas / Pelotitas / Kiosco" is where the
 * complex starts, never where it ends. Seeded with those three so the screen is
 * usable on first load.
 *
 * unique(['name', 'deleted_at']) follows the same NULL-distinct convention as
 * roles.name — at most one LIVE category per name, retired ones keep their row.
 */
export default class extends BaseSchema {
  protected tableName = 'product_categories'

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
      for (const name of ['Paletas', 'Pelotitas', 'Kiosco']) {
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
