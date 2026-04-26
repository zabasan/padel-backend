import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('key', 100).primary()
      table.text('value').nullable()
    })
    // Insert defaults after table is created
    this.defer(async (db) => {
      await db.table('settings').insert([
        { key: 'appTitle', value: 'Padel Complex' },
        { key: 'appLogo', value: null },
      ])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
