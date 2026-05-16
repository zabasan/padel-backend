import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Force existing workers/professors with temp emails to re-complete their profile
    // (set real email + password) on next login
    await this.db.rawQuery(
      `UPDATE users SET has_logged_in = 0 WHERE role IN ('worker', 'professor') AND email LIKE '%@padel.temp'`
    )
  }

  async down() {
    await this.db.rawQuery(
      `UPDATE users SET has_logged_in = 1 WHERE role IN ('worker', 'professor') AND email LIKE '%@padel.temp'`
    )
  }
}
