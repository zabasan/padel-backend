import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `users.role` was a strict MySQL ENUM('admin','worker','customer','professor')
 * (see 1780000000010_fix_role_enum_add_professor.ts). D2 requires it to hold
 * ANY role name going forward (starting with 'supervisor'), and a strict
 * ENUM truncates/rejects any value outside its fixed list — the sync hook
 * in user.ts would fail the moment a user is assigned a role added after
 * this migration.
 *
 * Also fixes a latent collation mismatch discovered while wiring this up:
 * `role` was `utf8mb4_0900_ai_ci` while `roles.name` (and every other new
 * RBAC table) is `utf8mb4_unicode_ci` (this database's actual default).
 * Comparing the two directly (as the rollout's consistency check does) threw
 * "Illegal mix of collations" before this fix.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    await this.db.rawQuery(
      "ALTER TABLE `users` MODIFY COLUMN `role` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'customer'"
    )
  }

  async down() {
    await this.db.rawQuery(
      "ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin', 'worker', 'customer', 'professor') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'customer'"
    )
  }
}
