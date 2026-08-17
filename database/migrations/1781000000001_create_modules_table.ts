import { BaseSchema } from '@adonisjs/lucid/schema'
import { MODULES } from '#database/seed_data/permission_matrix'

/**
 * `modules` is the catalog of permission modules. Rows are added ONLY by
 * migrations, never at runtime — a new commerce module ships its own
 * migration alongside the matching role_permissions seed.
 */
export default class extends BaseSchema {
  protected tableName = 'modules'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name', 60).notNullable().unique()
      table.string('visible_name', 100).notNullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
    })

    this.defer(async (db) => {
      for (const mod of MODULES) {
        const existing = await db.from(this.tableName).where('name', mod.name).first()
        if (!existing) {
          await db.table(this.tableName).insert({
            name: mod.name,
            visible_name: mod.visibleName,
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
