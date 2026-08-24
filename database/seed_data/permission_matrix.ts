import type { ModulePermissions } from '#services/permissions'

/**
 * Single source of truth for the permission catalog and the seeded role matrix.
 *
 * Imported by BOTH the seeding migrations and the regression tests, so the seed
 * and the test that guards it can never drift apart.
 *
 * Module rows are added ONLY by migrations, never at runtime.
 */

export interface ModuleDefinition {
  /** Stable English key used in code, route annotations and permission rows. */
  name: string
  /** Spanish label rendered in the admin UI. */
  visibleName: string
}

export const MODULES: ModuleDefinition[] = [
  { name: 'courts', visibleName: 'Canchas' },
  { name: 'reservations', visibleName: 'Reservas' },
  { name: 'reservation_management', visibleName: 'Gestión de reservas' },
  // Authority to book past a business rule that would otherwise reject the
  // reservation. Kept apart from `reservation_management` on purpose: skipping a
  // restriction and deleting/cancelling a past reservation are different jobs, so
  // one can be granted without the other. Only `create` is read today — same
  // subset-of-verbs shape as `audit` (view only) and `settings` (view/update).
  { name: 'reservation_overrides', visibleName: 'Excepciones de reserva' },
  { name: 'payments', visibleName: 'Pagos' },
  { name: 'users', visibleName: 'Usuarios' },
  { name: 'audit', visibleName: 'Auditoría' },
  { name: 'stats', visibleName: 'Estadísticas' },
  { name: 'settings', visibleName: 'Configuración' },
  { name: 'roles', visibleName: 'Roles' },
  { name: 'user_permissions', visibleName: 'Permisos por usuario' },
  // Commerce. Split in two on purpose: selling and setting prices are different
  // jobs. A kiosk attendant needs `sales.create` without `products.update`, or
  // anyone allowed to ring up a sale could also rewrite the price list.
  { name: 'products', visibleName: 'Productos' },
  { name: 'sales', visibleName: 'Ventas' },
  // Gastos de las instalaciones (servicios, limpieza, mantenimiento, insumos). Módulo
  // propio y NO parte de `sales`: cobrar plata y sacar plata son trabajos distintos, y
  // el gasto es lo único que baja el resultado del período. Quien atiende el kiosco puede
  // necesitar `sales.create` sin poder cargar ni ver el gasto de un proveedor.
  { name: 'expenses', visibleName: 'Gastos' },
  // La caja: abrirla, cerrarla y ver el arqueo del turno. Tres verbos y no cuatro —
  // `view` es ver el turno y el historial, `create` es ABRIR y `update` es CERRAR.
  // Sin `erase`: un cierre de caja es un hecho, no se borra. Abrir y cerrar están
  // separados a propósito para que el día que quieran que solo el encargado cierre
  // sea un click en el ABM de Roles y no una migración.
  { name: 'cash_register', visibleName: 'Caja' },
]

export const MODULE_NAMES: string[] = MODULES.map((m) => m.name)

/**
 * Roles seeded on migration. The first four mirror the pre-existing
 * `users.role` enum; `supervisor` is new and starts with zero users.
 */
export const SEEDED_ROLES = ['admin', 'supervisor', 'worker', 'customer', 'professor'] as const
export type SeededRole = (typeof SEEDED_ROLES)[number]

/**
 * Compact spec parser: 'vcue' -> all four, 'vu' -> view + update, '' -> none.
 * Keeps the matrix below visually identical to the table in the plan.
 */
function p(spec: string): ModulePermissions {
  return {
    view: spec.includes('v'),
    create: spec.includes('c'),
    update: spec.includes('u'),
    erase: spec.includes('e'),
  }
}

/**
 * The seeded matrix reproduces today's effective access EXACTLY — no role gains
 * or loses anything on day one. `supervisor` is the only exception, and it is
 * seeded with zero users, so nobody's access changes.
 *
 * v = view, c = create, u = update, e = erase.
 */
export const ROLE_PERMISSION_MATRIX: Record<SeededRole, Record<string, ModulePermissions>> = {
  admin: {
    courts: p('vcue'),
    reservations: p('vcue'),
    reservation_management: p('vcue'),
    reservation_overrides: p('c'),
    payments: p('vcue'),
    users: p('vcue'),
    audit: p('v'),
    stats: p('v'),
    settings: p('vu'),
    roles: p('vcue'),
    user_permissions: p('vu'),
    products: p('vcue'),
    sales: p('vcue'),
    expenses: p('vcue'),
    cash_register: p('vcu'),
  },
  // admin minus `roles` and `user_permissions` — see D6/D7.
  supervisor: {
    courts: p('vcue'),
    reservations: p('vcue'),
    reservation_management: p('vcue'),
    reservation_overrides: p('c'),
    payments: p('vcue'),
    users: p('vcue'),
    audit: p('v'),
    stats: p('v'),
    settings: p('vu'),
    roles: p(''),
    user_permissions: p(''),
    products: p('vcue'),
    sales: p('vcue'),
    // Tercera excepción a "supervisor = admin", junto con roles y user_permissions.
    // Los gastos del complejo son plata del dueño, no de la operación diaria, así que
    // el día uno los tiene solo admin. El módulo existe aparte justamente para que
    // habilitárselo al supervisor sea un click en el ABM de Roles y no una migración.
    expenses: p(''),
    cash_register: p('vcu'),
  },
  worker: {
    courts: p('vcue'),
    reservations: p('vcue'),
    reservation_management: p('vu'),
    reservation_overrides: p(''),
    payments: p('vc'),
    users: p('vcu'),
    audit: p(''),
    stats: p(''),
    settings: p(''),
    roles: p(''),
    user_permissions: p(''),
    // Sells and restocks, but cannot change the price list or void a sale.
    products: p('vu'),
    sales: p('vc'),
    // Arranca cerrado, como todo módulo nuevo. Cargar un gasto mueve el resultado del
    // período, así que se concede explícitamente desde el ABM de Roles cuando el complejo
    // lo decida — no se asume acá.
    expenses: p(''),
    // Único módulo nuevo que arranca ABIERTO para worker: el pedido es explícitamente
    // que los chicos del mostrador abran y cierren la caja de su turno. Sin esto la
    // función no existe para quien la va a usar.
    cash_register: p('vcu'),
  },
  // Customers and professors hold every verb on `reservations` on purpose:
  // ownership ("only your own") is enforced in the controller, not in this grid.
  customer: {
    courts: p('v'),
    reservations: p('vcue'),
    reservation_management: p(''),
    reservation_overrides: p(''),
    payments: p(''),
    users: p(''),
    audit: p(''),
    stats: p(''),
    settings: p(''),
    roles: p(''),
    user_permissions: p(''),
    products: p(''),
    sales: p(''),
    expenses: p(''),
    cash_register: p(''),
  },
  professor: {
    courts: p('v'),
    reservations: p('vcue'),
    reservation_management: p(''),
    // Nunca acá: el profesor sigue atado a la ventana horaria configurada.
    reservation_overrides: p(''),
    payments: p(''),
    users: p(''),
    audit: p(''),
    stats: p(''),
    settings: p(''),
    roles: p(''),
    user_permissions: p(''),
    products: p(''),
    sales: p(''),
    expenses: p(''),
    cash_register: p(''),
  },
}
