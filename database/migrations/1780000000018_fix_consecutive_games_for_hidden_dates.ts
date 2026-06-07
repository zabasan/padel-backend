import { BaseSchema } from '@adonisjs/lucid/schema'

const ART_OFFSET_MS = -3 * 60 * 60 * 1000

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default class extends BaseSchema {
  async up() {
    // Recompute consecutive_games as the current streak:
    //   - List all past weekly occurrences from start_time up to yesterday (ART)
    //   - Find the most recent hidden occurrence (streak breaker)
    //   - Count non-hidden occurrences AFTER that breaker
    //   - Apply % cycle if promo is enabled

    const [settingsRows] = (await this.db.rawQuery(
      `SELECT \`key\`, value FROM settings WHERE \`key\` IN ('recurringPromoEnabled','recurringPromoGames','recurringPromoFreeGames')`
    )) as [{ key: string; value: string }[], unknown]

    const settings: Record<string, string> = {}
    for (const row of settingsRows ?? []) settings[row.key] = row.value
    const promoEnabled = settings['recurringPromoEnabled'] === 'true'
    const promoGames = parseInt(settings['recurringPromoGames'] ?? '9', 10)
    const promoFreeGames = parseInt(settings['recurringPromoFreeGames'] ?? '1', 10)
    const cycle = promoGames + promoFreeGames

    const [reservations] = (await this.db.rawQuery(
      `SELECT id, start_time FROM reservations WHERE is_recurring = 1`
    )) as [{ id: number; start_time: Date | string }[], unknown]

    const [hiddenRows] = (await this.db.rawQuery(
      `SELECT reservation_id, hidden_date FROM reservation_hidden_dates`
    )) as [{ reservation_id: number; hidden_date: Date | string }[], unknown]

    const hiddenByRes: Record<number, Set<string>> = {}
    for (const row of hiddenRows ?? []) {
      const dateStr =
        row.hidden_date instanceof Date
          ? toDateStr(row.hidden_date)
          : String(row.hidden_date).slice(0, 10)
      if (!hiddenByRes[row.reservation_id]) hiddenByRes[row.reservation_id] = new Set()
      hiddenByRes[row.reservation_id].add(dateStr)
    }

    const nowART = new Date(Date.now() + ART_OFFSET_MS)
    const todayART = new Date(nowART.getFullYear(), nowART.getMonth(), nowART.getDate())

    for (const res of reservations ?? []) {
      const startUTC =
        res.start_time instanceof Date ? res.start_time : new Date(res.start_time)
      const startART = new Date(startUTC.getTime() + ART_OFFSET_MS)
      const firstOcc = new Date(startART.getFullYear(), startART.getMonth(), startART.getDate())

      const hidden = hiddenByRes[res.id] ?? new Set()

      // Build list of all past occurrences in order
      const occurrences: string[] = []
      const cur = new Date(firstOcc)
      while (cur < todayART) {
        occurrences.push(toDateStr(cur))
        cur.setDate(cur.getDate() + 7)
      }

      // Find the index of the last hidden occurrence (streak breaker)
      let streakStart = 0
      for (let i = 0; i < occurrences.length; i++) {
        if (hidden.has(occurrences[i])) {
          streakStart = i + 1 // streak resets after this hidden date
        }
      }

      // Count non-hidden occurrences from streakStart onward
      let streak = 0
      for (let i = streakStart; i < occurrences.length; i++) {
        if (!hidden.has(occurrences[i])) streak++
      }

      const corrected = promoEnabled && cycle > 0 ? streak % cycle : streak

      await this.db.rawQuery(`UPDATE reservations SET consecutive_games = ? WHERE id = ?`, [
        corrected,
        res.id,
      ])
    }
  }

  async down() {
    // Cannot reverse — original values were not snapshotted
  }
}
