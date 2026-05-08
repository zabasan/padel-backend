import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    await this.db.rawQuery(
      "ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin', 'worker', 'customer', 'professor') NOT NULL DEFAULT 'customer'"
    )
  }

  async down() {
    await this.db.rawQuery(
      "ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin', 'worker', 'customer') NOT NULL DEFAULT 'customer'"
    )
  }
}
