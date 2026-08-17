import { BaseSchema } from '@adonisjs/lucid/schema'
import { SEEDED_ROLES } from '#database/seed_data/permission_matrix'

/**
 * `roles` backs the new role_id on users. `users.role` (the legacy string
 * column) is KEPT and stays in sync via a model hook — see user.ts.
 *
 * unique(['name', 'deleted_at']), NOT unique(['name']): MySQL treats NULLs as
 * distinct, so this allows exactly one LIVE row per name while any number of
 * soft-deleted rows may repeat it. A plain unique(name) would make a
 * soft-deleted role impossible to ever re-create.
 */
export default class extends BaseSchema {
  protected tableName = 'roles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name', 50).notNullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
      table.timestamp('deleted_at', { useTz: true }).nullable()
      table.unique(['name', 'deleted_at'])
      table.index(['deleted_at'])
    })

    this.defer(async (db) => {
      for (const name of SEEDED_ROLES) {
        const existing = await db.from(this.tableName).where('name', name).first()
        if (!existing) {
          await db
            .table(this.tableName)
            .insert({ name, created_at: new Date(), updated_at: new Date() })
        }
      }
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
