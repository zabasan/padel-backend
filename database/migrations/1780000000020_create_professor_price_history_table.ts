import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    await this.schema.dropTableIfExists('professor_price_history')

    this.schema.createTable('professor_price_history', (table) => {
      table.increments('id')
      table.timestamp('effective_from', { useTz: true }).notNullable()
      table.decimal('price_individual', 10, 2).notNullable()
      table.decimal('price_group', 10, 2).notNullable()
      table.decimal('price_individual_weekend', 10, 2).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['effective_from'])
    })

    // Backfill two versions:
    //   - OLD prices effective from 2026-01-01 (individual 10000, group 12000, weekend 12000)
    //   - CURRENT prices effective from 2026-05-01 (from settings, or code defaults)
    this.defer(async (db) => {
      const EFF_CURRENT = '2026-05-01 00:00:00'
      const EFF_OLD = '2026-01-01 00:00:00'
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

      const settings = await db
        .from('settings')
        .whereIn('key', [
          'professorPriceIndividual',
          'professorPriceGroup',
          'professorPriceIndividualWeekend',
        ])
      const map: Record<string, string> = {}
      for (const s of settings) map[s.key] = s.value ?? ''

      const curIndividual = map['professorPriceIndividual']
        ? Number(map['professorPriceIndividual'])
        : 12000
      const curGroup = map['professorPriceGroup'] ? Number(map['professorPriceGroup']) : 15000
      const curWeekend = map['professorPriceIndividualWeekend']
        ? Number(map['professorPriceIndividualWeekend'])
        : 15000

      await db.table('professor_price_history').insert({
        effective_from: EFF_OLD,
        price_individual: 10000,
        price_group: 12000,
        price_individual_weekend: 12000,
        created_at: now,
      })

      await db.table('professor_price_history').insert({
        effective_from: EFF_CURRENT,
        price_individual: curIndividual,
        price_group: curGroup,
        price_individual_weekend: curWeekend,
        created_at: now,
      })
    })
  }

  async down() {
    this.schema.dropTableIfExists('professor_price_history')
  }
}
