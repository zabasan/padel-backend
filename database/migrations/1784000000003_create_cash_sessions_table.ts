import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Una sesión de caja: el turno abierto en el mostrador.
 *
 * La caja del complejo es UNA (el cajón es uno, físico), así que las sesiones son
 * secuenciales: se abre una, se cierra, se abre la siguiente. El invariante del que
 * depende todo el módulo es:
 *
 *   Nunca hay más de una sesión abierta, y no se registra plata sin sesión abierta.
 *
 * De ahí sale que los movimientos de un turno se puedan DERIVAR por ventana de tiempo
 * (created_at entre opened_at y closed_at) en lugar de guardar un cash_session_id en
 * reservation_payments, sales y expenses. Eso ahorra tres migraciones y tres
 * write-paths tocados — pero es correcto SOLO si el invariante se cumple de verdad,
 * así que se refuerza acá y no en el controller.
 *
 * `open_marker` es quien lo refuerza: vale 1 mientras la sesión está abierta y NULL
 * cuando se cierra. MySQL permite muchos NULL en un índice UNIQUE, así que el índice
 * deja pasar infinitas sesiones cerradas y rechaza una segunda ABIERTA a nivel base de
 * datos. Un `if` en el controller pierde contra dos requests concurrentes; esto no.
 *
 * `shift_name` y los dos minutos son un SNAPSHOT del turno configurado en settings al
 * momento de abrir. Si mañana cambian los turnos, los cierres viejos siguen contando
 * la verdad de cuando pasaron — misma decisión que court_price_history.
 *
 * Las tres columnas de pago se llaman igual que en reservation_payments, sales y
 * expenses (efectivo / transferencia / postnet) por la misma razón que explica la
 * migración de sales: el arqueo tiene que sumar sin traducir. Van separadas en
 * entradas y salidas, no neteadas: cobrar $50.000 y pagar $3.000 de un gasto no es lo
 * mismo que cobrar $47.000, y el conteo del cajón necesita distinguirlo.
 */
export default class extends BaseSchema {
  protected tableName = 'cash_sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Snapshot del turno, no una FK a settings.
      table.string('shift_name', 40).notNullable()
      table.integer('shift_start_minute').notNullable()
      table.integer('shift_end_minute').notNullable()
      // El día ART al que pertenece el turno. Para el turno de 16 a 24 es el día en que
      // arrancó, aunque termine a la medianoche del siguiente.
      table.date('business_date').notNullable()

      // PRECISIÓN 3 (milisegundos), y no la del resto de la app, por una razón concreta.
      //
      // Los movimientos de un turno se derivan por ventana semiabierta
      // [opened_at, closed_at) sobre el `created_at` de las tablas de plata, que tiene
      // precisión de SEGUNDO. Si los bordes también se truncaran al segundo, un cobro
      // hecho en el mismo segundo que el cierre daría `created_at < closed_at` = falso y
      // se caería de su propio turno.
      //
      // Con los bordes en milisegundos la ventana es estrictamente más fina que los
      // hechos que acota, y la atribución vuelve a ser exacta: ningún movimiento se
      // pierde ni se cuenta dos veces. El caso inverso — un movimiento creado DESPUÉS
      // del cierre en el mismo segundo — no puede existir: con la caja cerrada el
      // middleware bloquea el cobro.
      table.timestamp('opened_at', { useTz: true, precision: 3 }).notNullable()
      table.integer('opened_by').unsigned().notNullable().references('id').inTable('users')
      // Informativo: alimenta el "cierra 24:00" de la pantalla. NO es lo que dispara la
      // rotación — eso lo decide la comparación de turnos, ver cash_register_middleware.
      table.timestamp('expected_close_at', { useTz: true, precision: 3 }).notNullable()

      table.timestamp('closed_at', { useTz: true, precision: 3 }).nullable()
      table
        .integer('closed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.decimal('opening_efectivo', 10, 2).notNullable().defaultTo(0)

      table.decimal('in_efectivo', 10, 2).notNullable().defaultTo(0)
      table.decimal('in_transferencia', 10, 2).notNullable().defaultTo(0)
      table.decimal('in_postnet', 10, 2).notNullable().defaultTo(0)
      table.decimal('out_efectivo', 10, 2).notNullable().defaultTo(0)
      table.decimal('out_transferencia', 10, 2).notNullable().defaultTo(0)
      table.decimal('out_postnet', 10, 2).notNullable().defaultTo(0)
      table.integer('movements_count').unsigned().notNullable().defaultTo(0)

      // Lo que contaron en el cajón al cerrar. Nullable porque contar es opcional: un
      // cierre sin conteo sigue siendo un cierre válido.
      table.decimal('counted_efectivo', 10, 2).nullable()
      table.string('notes', 500).nullable()

      // 1 = abierta, NULL = cerrada. Ver el docblock.
      table.tinyint('open_marker').nullable().unique()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true })

      table.index(['closed_at'])
      table.index(['business_date'])
      table.index(['opened_by'])
      table.index(['closed_by'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
