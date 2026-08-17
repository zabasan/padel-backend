import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Grips and paddle protectors ship under a single "Accesorios" category rather than one
 * category each. Categories are DATA (see 1782000000002) — splitting this later is an ABM
 * click, not a migration. What does not undo itself as cheaply is a POS grid with a chip per
 * two-product category, which slows down every single sale.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const existing = await db.from('product_categories').where('name', 'Accesorios').first()
      if (!existing) {
        await db.table('product_categories').insert({
          name: 'Accesorios',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      await db.from('product_categories').where('name', 'Accesorios').delete()
    })
  }
}
