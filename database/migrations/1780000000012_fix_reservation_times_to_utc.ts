import { BaseSchema } from '@adonisjs/lucid/schema'

// All existing reservations have start_time/end_time stored as Argentina local time
// (naive, without offset) but the server runs in TZ=UTC, so they are 3 hours behind
// actual UTC. This migration adds 3 hours to convert them to real UTC values.
export default class extends BaseSchema {
  protected tableName = 'reservations'

  async up() {
    await this.db.rawQuery(
      `UPDATE ${this.tableName} SET start_time = DATE_ADD(start_time, INTERVAL 3 HOUR), end_time = DATE_ADD(end_time, INTERVAL 3 HOUR)`
    )
  }

  async down() {
    await this.db.rawQuery(
      `UPDATE ${this.tableName} SET start_time = DATE_SUB(start_time, INTERVAL 3 HOUR), end_time = DATE_SUB(end_time, INTERVAL 3 HOUR)`
    )
  }
}
