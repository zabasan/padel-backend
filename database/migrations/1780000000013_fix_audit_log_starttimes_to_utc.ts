import { BaseSchema } from '@adonisjs/lucid/schema'

// Audit log entries for startTime were stored as Argentina local time (naive, without
// offset). Add 3 hours to convert old_value/new_value to real UTC.
export default class extends BaseSchema {
  async up() {
    const rows = await this.db.from('reservation_audit_logs').where('field', 'startTime')
    for (const row of rows) {
      const updates: Record<string, string | null> = {}
      if (row.old_value) {
        const d = new Date(row.old_value)
        d.setTime(d.getTime() + 3 * 60 * 60 * 1000)
        updates.old_value = d.toISOString()
      }
      if (row.new_value) {
        const d = new Date(row.new_value)
        d.setTime(d.getTime() + 3 * 60 * 60 * 1000)
        updates.new_value = d.toISOString()
      }
      if (Object.keys(updates).length > 0) {
        await this.db.from('reservation_audit_logs').where('id', row.id).update(updates)
      }
    }
  }

  async down() {
    const rows = await this.db.from('reservation_audit_logs').where('field', 'startTime')
    for (const row of rows) {
      const updates: Record<string, string | null> = {}
      if (row.old_value) {
        const d = new Date(row.old_value)
        d.setTime(d.getTime() - 3 * 60 * 60 * 1000)
        updates.old_value = d.toISOString()
      }
      if (row.new_value) {
        const d = new Date(row.new_value)
        d.setTime(d.getTime() - 3 * 60 * 60 * 1000)
        updates.new_value = d.toISOString()
      }
      if (Object.keys(updates).length > 0) {
        await this.db.from('reservation_audit_logs').where('id', row.id).update(updates)
      }
    }
  }
}
