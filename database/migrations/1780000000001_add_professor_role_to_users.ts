import { BaseSchema } from '@adonisjs/lucid/schema'

// This migration is a no-op: role is stored as VARCHAR and already accepts any string value.
// The 'professor' role is enforced at the application layer (validators + TypeScript).
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    // No schema change needed — role column is already VARCHAR
  }

  async down() {
    // No change to revert
  }
}
