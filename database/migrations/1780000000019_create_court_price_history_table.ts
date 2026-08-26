import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Drop if it was partially created by a failed prior migration attempt
    await this.schema.dropTableIfExists('court_price_history')

    this.schema.createTable('court_price_history', (table) => {
      table.increments('id')
      table
        .integer('court_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('courts')
        .onDelete('CASCADE')
      table.timestamp('effective_from', { useTz: true }).notNullable()
      table.decimal('start_hour', 5, 2).notNullable()
      table.decimal('end_hour', 5, 2).notNullable()
      table.decimal('price_per_hour', 10, 2).notNullable()
      table.boolean('is_peak_hour').notNullable().defaultTo(false)
      table.decimal('price_60_min', 10, 2).nullable()
      table.decimal('price_90_min', 10, 2).nullable()
      table.decimal('price_120_min', 10, 2).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.index(['court_id', 'effective_from'])
    })

    // Backfill two versions of the price history:
    //   - OLD prices effective from 2026-01-01
    //   - CURRENT prices (whatever is in court_price_ranges now) effective from 2026-05-01
    // Old prices are mapped by court NAME (robust to differing court IDs across envs).
    // We reuse each court's existing range boundaries (start_hour/end_hour) and only
    // change the price VALUES, splitting morning (start_hour < 17) vs evening bands.
    this.defer(async (db) => {
      const EFF_CURRENT = '2026-05-01 00:00:00'
      const EFF_OLD = '2026-01-01 00:00:00'
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19)

      // Old padel duration prices by category and band (morning=8, evening=17)
      const oldPadel: Record<string, Record<number, { p60: number; p90: number; p120: number }>> = {
        conTecho: {
          8: { p60: 20000, p90: 27200, p120: 38000 },
          17: { p60: 29200, p90: 40000, p120: 50000 },
        },
        sinTecho: {
          8: { p60: 18000, p90: 25200, p120: 36000 },
          17: { p60: 28000, p90: 38000, p120: 48000 },
        },
      }
      // Old football price-per-hour by category and band
      const oldFootball: Record<string, Record<number, number>> = {
        f8: { 8: 83200, 17: 96000 },
        f5: { 8: 40000, 17: 45000 },
      }

      const ranges = await db
        .from('court_price_ranges')
        .join('courts', 'courts.id', 'court_price_ranges.court_id')
        .select(
          'court_price_ranges.court_id',
          'courts.name as court_name',
          'courts.type as court_type',
          'court_price_ranges.start_hour',
          'court_price_ranges.end_hour',
          'court_price_ranges.price_per_hour',
          'court_price_ranges.is_peak_hour',
          'court_price_ranges.price_60_min',
          'court_price_ranges.price_90_min',
          'court_price_ranges.price_120_min'
        )

      for (const r of ranges) {
        // ── CURRENT snapshot — copy ranges as-is ──
        await db.table('court_price_history').insert({
          court_id: r.court_id,
          effective_from: EFF_CURRENT,
          start_hour: r.start_hour,
          end_hour: r.end_hour,
          price_per_hour: r.price_per_hour,
          is_peak_hour: r.is_peak_hour ?? false,
          price_60_min: r.price_60_min ?? null,
          price_90_min: r.price_90_min ?? null,
          price_120_min: r.price_120_min ?? null,
          created_at: now,
        })

        // ── OLD snapshot — same boundaries, old values by category ──
        const name = String(r.court_name ?? '')
        const band = Number(r.start_hour) < 17 ? 8 : 17
        let oldPerHour = r.price_per_hour
        let old60: number | null = null
        let old90: number | null = null
        let old120: number | null = null

        if (r.court_type === 'padel') {
          const cat = /tech/i.test(name) ? 'conTecho' : 'sinTecho'
          const v = oldPadel[cat][band]
          old60 = v.p60
          old90 = v.p90
          old120 = v.p120
          // keep current price_per_hour as the custom-duration fallback
        } else {
          const cat = /8/.test(name) ? 'f8' : 'f5'
          oldPerHour = oldFootball[cat][band]
        }

        await db.table('court_price_history').insert({
          court_id: r.court_id,
          effective_from: EFF_OLD,
          start_hour: r.start_hour,
          end_hour: r.end_hour,
          price_per_hour: oldPerHour,
          is_peak_hour: r.is_peak_hour ?? false,
          price_60_min: old60,
          price_90_min: old90,
          price_120_min: old120,
          created_at: now,
        })
      }
    })
  }

  async down() {
    this.schema.dropTableIfExists('court_price_history')
  }
}
