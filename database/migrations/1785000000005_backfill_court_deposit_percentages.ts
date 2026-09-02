import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Rellena la seña de cada cancha existente. La columna la creó
 * `1785000000004_add_deposit_percentage_to_courts` sin default, así que sin este backfill
 * todas las canchas quedan en `null` — o sea, siguiendo al global de Ajustes.
 *
 * Y ahí está el problema que esto evita: `null` NO deja las canchas sin seña, las deja con
 * la del global. Con un global en 50, las de fútbol 5 pedirían 50% en vez de 20% y nadie lo
 * notaría hasta que un cliente pagara de más. El riesgo no es dejar de cobrar seña, es
 * cobrar la de pádel en una cancha de fútbol.
 *
 * ── Por qué una LISTA de nombres y no una regla ────────────────────────────
 * La tentación es derivarlo de la estructura: `padel` → 50, `football` sin cancha padre →
 * 30 (fútbol 8), `football` con cancha padre → 20 (fútbol 5). Funciona hoy, pero deja el
 * número atado a una relación padre-hija que existe para otra cosa (bloquear turnos
 * solapados), no para clasificar tarifas. El día que alguien divida una cancha de pádel o
 * cargue un fútbol 8 sin hijas, la regla contesta cualquier cosa sin avisar.
 *
 * La lista explícita, en cambio, no infiere: dice exactamente qué cancha cobra cuánto, y
 * lo que no está en la lista no se toca. Incluye el nombre inconsistente tal cual está en
 * la base — `Cancha de Futbol 5 (3)`, sin tilde y con "de", a diferencia de sus hermanas.
 * Ese es justo el caso que una regla por nombre con regex se habría comido en silencio.
 *
 * ── Solo filas en null ─────────────────────────────────────────────────────
 * El `whereNull` es lo que hace esto seguro de correr: si alguien ya configuró una cancha
 * a mano, su valor gana. Un backfill que pisa una decisión tomada es peor que no correr.
 */
const DEPOSIT_BY_COURT_NAME: Array<[string, number]> = [
  ['Padel 1', 50],
  ['Padel 2 Techada', 50],
  ['Padel 3 Techada', 50],
  ['Cancha Fútbol 8', 30],
  ['Cancha Fútbol 5 (1)', 20],
  ['Cancha Fútbol 5 (2)', 20],
  ['Cancha de Futbol 5 (3)', 20],
]

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const [name, percentage] of DEPOSIT_BY_COURT_NAME) {
        const result = await db
          .from('courts')
          .where('name', name)
          .whereNull('deposit_percentage')
          .update({ deposit_percentage: percentage })

        // Lucid tipa `.update()` como `any[]`, pero MySQL resuelve la cantidad de filas
        // afectadas. `Number()` normaliza las dos formas: de un número lo deja igual, y de
        // un array vacío da 0 — que es la respuesta correcta para "no tocó nada".
        const updated = Number(result)

        // Se informa fila por fila a propósito. Una cancha renombrada en producción no
        // matchea y se salta: sin este log el deploy diría "migración ok" y esa cancha se
        // quedaría con la seña del global sin que nadie se enterara.
        if (updated === 0) {
          console.log(
            `[backfill seña] "${name}": sin cambios (no existe, o ya tiene una seña propia)`
          )
        } else {
          console.log(`[backfill seña] "${name}" → ${percentage}% (${updated} fila/s)`)
        }
      }
    })
  }

  async down() {
    this.defer(async (db) => {
      // Vuelve a null SOLO las que todavía tienen exactamente el valor que escribió este
      // backfill. Si alguien la cambió después, ese cambio es una decisión suya y sobrevive
      // al rollback.
      for (const [name, percentage] of DEPOSIT_BY_COURT_NAME) {
        await db
          .from('courts')
          .where('name', name)
          .where('deposit_percentage', percentage)
          .update({ deposit_percentage: null })
      }
    })
  }
}
