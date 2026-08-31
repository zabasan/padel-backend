import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

router.get('/', () => {
  return { service: 'Padel Complex API', version: '1.0' }
})

router
  .group(() => {
    // Auth routes (public)
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')

    // Settings — public read, no auth required
    router.get('settings', [controllers.Settings, 'show'])

    // Public reads — guests need these to browse courts before reserving
    router.get('courts', [controllers.Courts, 'index'])
    router.get('courts/availability', [controllers.Reservations, 'availability'])
    router.get('courts/:id', [controllers.Courts, 'show'])

    // Guest reservation — creates user + reservation atomically, no auth required
    router.post('guest/reservations', [controllers.GuestReservations, 'store'])

    // Authenticated routes — accessible even with hasLoggedIn=false (profile/logout/complete)
    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
        router.put('complete-profile', [controllers.CompleteProfile, 'store'])
      })
      .prefix('account')
      .use(middleware.auth())

    // Authenticated routes — require completed profile for non-customers
    router
      .group(() => {
        // Courts - write only for admin and worker
        router.group(() => {
          router
            .post('courts', [controllers.Courts, 'store'])
            .use(middleware.permission({ module: 'courts', action: 'create' }))
          router
            .put('courts/:id', [controllers.Courts, 'update'])
            .use(middleware.permission({ module: 'courts', action: 'update' }))
          router
            .delete('courts/:id', [controllers.Courts, 'destroy'])
            .use(middleware.permission({ module: 'courts', action: 'erase' }))
          router
            .patch('courts/:id/toggle', [controllers.Courts, 'toggleActive'])
            .use(middleware.permission({ module: 'courts', action: 'update' }))
          router
            .put('courts/:id/price-ranges', [controllers.Courts, 'updatePriceRanges'])
            .use(middleware.permission({ module: 'courts', action: 'update' }))
        })

        // Reservations - read/create/cancel for all authenticated users
        router
          .get('reservations', [controllers.Reservations, 'index'])
          .use(middleware.permission({ module: 'reservations', action: 'view' }))
        router
          .get('reservations/:id', [controllers.Reservations, 'show'])
          .use(middleware.permission({ module: 'reservations', action: 'view' }))
        router
          .post('reservations', [controllers.Reservations, 'store'])
          .use(middleware.permission({ module: 'reservations', action: 'create' }))
        router
          .put('reservations/:id', [controllers.Reservations, 'update'])
          .use(middleware.permission({ module: 'reservations', action: 'update' }))
        router
          .delete('reservations/:id', [controllers.Reservations, 'destroy'])
          .use(middleware.permission({ module: 'reservations', action: 'erase' }))
        // Notes-only edit: a strictly weaker form of the PUT above, so it carries the same
        // permission. It exists as its own route because the full edit recalculates the price.
        router
          .patch('reservations/:id/notes', [controllers.Reservations, 'updateNotes'])
          .use(middleware.permission({ module: 'reservations', action: 'update' }))

        // Reservation management actions - admin and worker only
        router.group(() => {
          router
            .patch('reservations/:id/hide-next', [controllers.Reservations, 'hideNext'])
            .use(middleware.permission({ module: 'reservation_management', action: 'update' }))
          router
            .patch('reservations/:id/show-next', [controllers.Reservations, 'showNext'])
            .use(middleware.permission({ module: 'reservation_management', action: 'update' }))
          router
            .patch('reservations/:id/pay-deposit', [controllers.Reservations, 'payDeposit'])
            .use(middleware.permission({ module: 'payments', action: 'create' }))
            .use(middleware.cashRegister())
          router
            .patch('reservations/:id/pay-total', [controllers.Reservations, 'payTotal'])
            .use(middleware.permission({ module: 'payments', action: 'create' }))
            .use(middleware.cashRegister())
          // Cobrar la deuda arrastrada de una fija sin cobrar ningún turno. Es plata que
          // entra al cajón, así que lleva `cashRegister` igual que los otros dos cobros.
          router
            .patch('reservations/:id/settle-debt', [controllers.Reservations, 'settleDebt'])
            .use(middleware.permission({ module: 'payments', action: 'create' }))
            .use(middleware.cashRegister())
          router
            .get('reservations/:id/audit', [controllers.Reservations, 'auditLogs'])
            .use(middleware.permission({ module: 'reservation_management', action: 'view' }))
          // revert()/revertPayment()/revertAllPayments() also carry an inline
          // `user.role !== 'admin'` check (reservations_controller.ts) — this permission
          // annotation reproduces that EFFECTIVE admin-only access; the inline guard remains
          // as defense in depth. See permission_matrix.spec.ts's comment on the same routes.
          router
            .patch('reservations/:id/revert', [controllers.Reservations, 'revert'])
            .use(middleware.permission({ module: 'reservation_management', action: 'erase' }))
          router
            .delete('reservations/:id/payments/:paymentId', [
              controllers.Reservations,
              'revertPayment',
            ])
            .use(middleware.permission({ module: 'payments', action: 'erase' }))
            // Devolver un pago saca plata del cajón AHORA, no cuando se cobró.
            .use(middleware.cashRegister())
          router
            .delete('reservations/:id/payments', [controllers.Reservations, 'revertAllPayments'])
            .use(middleware.permission({ module: 'payments', action: 'erase' }))
            .use(middleware.cashRegister())
        })

        // Commerce — catálogo/stock (`products`) y caja del kiosco (`sales`).
        //
        // Son dos módulos y no uno porque vender y fijar precios son trabajos
        // distintos: quien atiende el kiosco necesita `sales.create` sin
        // `products.update`. Los dos endpoints de LECTURA que alimentan el POS
        // (categorías y catálogo) llevan el `or` con `sales.create` por la misma
        // razón que el listado de roles lo lleva con `users.view` — si no, un rol
        // que solo vende abriría la caja con la grilla vacía.
        router.group(() => {
          router.get('product-categories', [controllers.ProductCategories, 'index']).use(
            middleware.permission({
              module: 'products',
              action: 'view',
              or: { module: 'sales', action: 'create' },
            })
          )
          router
            .post('product-categories', [controllers.ProductCategories, 'store'])
            .use(middleware.permission({ module: 'products', action: 'create' }))
          router
            .put('product-categories/:id', [controllers.ProductCategories, 'update'])
            .use(middleware.permission({ module: 'products', action: 'update' }))
          router
            .delete('product-categories/:id', [controllers.ProductCategories, 'destroy'])
            .use(middleware.permission({ module: 'products', action: 'erase' }))

          // ANTES que `products/:id` — al revés, Adonis matchea :id = 'catalog'.
          router.get('products/catalog', [controllers.Products, 'catalog']).use(
            middleware.permission({
              module: 'products',
              action: 'view',
              or: { module: 'sales', action: 'create' },
            })
          )
          router
            .get('products', [controllers.Products, 'index'])
            .use(middleware.permission({ module: 'products', action: 'view' }))
          router
            .get('products/:id', [controllers.Products, 'show'])
            .use(middleware.permission({ module: 'products', action: 'view' }))
          router
            .get('products/:id/movements', [controllers.Products, 'movements'])
            .use(middleware.permission({ module: 'products', action: 'view' }))
          router
            .post('products', [controllers.Products, 'store'])
            .use(middleware.permission({ module: 'products', action: 'create' }))
          router
            .put('products/:id', [controllers.Products, 'update'])
            .use(middleware.permission({ module: 'products', action: 'update' }))
          router
            .patch('products/:id/toggle', [controllers.Products, 'toggleActive'])
            .use(middleware.permission({ module: 'products', action: 'update' }))
          router
            .post('products/:id/stock', [controllers.Products, 'adjustStock'])
            .use(middleware.permission({ module: 'products', action: 'update' }))
          router
            .delete('products/:id', [controllers.Products, 'destroy'])
            .use(middleware.permission({ module: 'products', action: 'erase' }))

          router
            .get('sales', [controllers.Sales, 'index'])
            .use(middleware.permission({ module: 'sales', action: 'view' }))
          router
            .get('sales/:id', [controllers.Sales, 'show'])
            .use(middleware.permission({ module: 'sales', action: 'view' }))
          router
            .post('sales', [controllers.Sales, 'store'])
            .use(middleware.permission({ module: 'sales', action: 'create' }))
            .use(middleware.cashRegister())
          router
            .delete('sales/:id', [controllers.Sales, 'destroy'])
            .use(middleware.permission({ module: 'sales', action: 'erase' }))
            // Anular devuelve plata al cliente AHORA, no cuando se vendió.
            .use(middleware.cashRegister())
        })

        // Gastos de las instalaciones (servicios, limpieza, mantenimiento, insumos).
        //
        // Módulo `expenses` propio, NO parte de `sales`: cobrar plata y sacar plata son
        // trabajos distintos, y el gasto es lo único de la app que BAJA el resultado del
        // período. Quien atiende el kiosco puede necesitar `sales.create` sin poder ver
        // ni cargar el gasto de un proveedor.
        //
        // Ningún gate lleva `or:`, a diferencia del catálogo del POS: no hay otra pantalla
        // que necesite las categorías de gasto, así que no hay a quién dejar entrar de
        // costado.
        router.group(() => {
          router
            .get('expense-categories', [controllers.ExpenseCategories, 'index'])
            .use(middleware.permission({ module: 'expenses', action: 'view' }))
          router
            .post('expense-categories', [controllers.ExpenseCategories, 'store'])
            .use(middleware.permission({ module: 'expenses', action: 'create' }))
          router
            .put('expense-categories/:id', [controllers.ExpenseCategories, 'update'])
            .use(middleware.permission({ module: 'expenses', action: 'update' }))
          router
            .delete('expense-categories/:id', [controllers.ExpenseCategories, 'destroy'])
            .use(middleware.permission({ module: 'expenses', action: 'erase' }))

          router
            .get('expenses', [controllers.Expenses, 'index'])
            .use(middleware.permission({ module: 'expenses', action: 'view' }))
          router
            .get('expenses/:id', [controllers.Expenses, 'show'])
            .use(middleware.permission({ module: 'expenses', action: 'view' }))
          router
            .post('expenses', [controllers.Expenses, 'store'])
            .use(middleware.permission({ module: 'expenses', action: 'create' }))
            .use(middleware.cashRegister())
          router
            .put('expenses/:id', [controllers.Expenses, 'update'])
            .use(middleware.permission({ module: 'expenses', action: 'update' }))
          // Anula, no borra — ver expenses_controller.destroy.
          router
            .delete('expenses/:id', [controllers.Expenses, 'destroy'])
            .use(middleware.permission({ module: 'expenses', action: 'erase' }))
            .use(middleware.cashRegister())
        })

        // Users management
        router.group(() => {
          router
            .post('users', [controllers.Users, 'store'])
            .use(middleware.permission({ module: 'users', action: 'create' }))
          router
            .get('users', [controllers.Users, 'index'])
            .use(middleware.permission({ module: 'users', action: 'view' }))
          router
            .get('users/search', [controllers.Users, 'search'])
            .use(middleware.permission({ module: 'users', action: 'view' }))
          router
            .get('users/:id', [controllers.Users, 'show'])
            .use(middleware.permission({ module: 'users', action: 'view' }))
          router
            .put('users/:id', [controllers.Users, 'update'])
            .use(middleware.permission({ module: 'users', action: 'update' }))
          router
            .post('users/:id/reset-login', [controllers.Users, 'resetLogin'])
            .use(middleware.permission({ module: 'users', action: 'update' }))
        })

        router
          .patch('users/:id/toggle-status', [controllers.Users, 'toggleStatus'])
          .use(middleware.permission({ module: 'users', action: 'erase' }))

        // Per-user permission extras — separate module from `users` itself, so
        // admins can grant "manage users" without also granting "manage everyone's
        // extra permissions" (D6).
        router.group(() => {
          router
            .get('users/:id/permissions', [controllers.UserPermissions, 'show'])
            .use(middleware.permission({ module: 'user_permissions', action: 'view' }))
          router
            .put('users/:id/permissions', [controllers.UserPermissions, 'update'])
            .use(middleware.permission({ module: 'user_permissions', action: 'update' }))
        })

        // Roles ABM — everything gated on the `roles` module. `roles.erase` on
        // DELETE, `roles.create`/`roles.update` on write, `roles.view` on reads
        // AND on the modules catalog (it exists only to feed this screen).
        router.group(() => {
          // Los dos listados salen del ABM pero también alimentan la pantalla de Usuarios: el de
          // roles llena los <select> de Rol y el filtro, y el catálogo de módulos dibuja la
          // matriz del tab "Permisos". Por eso aceptan además el permiso de la pantalla que los
          // consume — si no, administrar usuarios sin acceso al ABM sería imposible.
          router.get('roles', [controllers.Roles, 'index']).use(
            middleware.permission({
              module: 'roles',
              action: 'view',
              or: { module: 'users', action: 'view' },
            })
          )
          router.get('modules', [controllers.Roles, 'modules']).use(
            middleware.permission({
              module: 'roles',
              action: 'view',
              or: { module: 'user_permissions', action: 'view' },
            })
          )
          router
            .get('roles/:id', [controllers.Roles, 'show'])
            .use(middleware.permission({ module: 'roles', action: 'view' }))
          router
            .post('roles', [controllers.Roles, 'store'])
            .use(middleware.permission({ module: 'roles', action: 'create' }))
          router
            .put('roles/:id', [controllers.Roles, 'update'])
            .use(middleware.permission({ module: 'roles', action: 'update' }))
          router
            .delete('roles/:id', [controllers.Roles, 'destroy'])
            .use(middleware.permission({ module: 'roles', action: 'erase' }))
        })

        router.group(() => {
          router
            .delete('users/:id', [controllers.Users, 'destroy'])
            .use(middleware.permission({ module: 'users', action: 'erase' }))
          router
            .get('stats', [controllers.Stats, 'index'])
            .use(middleware.permission({ module: 'stats', action: 'view' }))
          router
            .put('settings', [controllers.Settings, 'update'])
            .use(middleware.permission({ module: 'settings', action: 'update' }))
          router
            .get('audit/users', [controllers.UserAuditLogs, 'index'])
            .use(middleware.permission({ module: 'audit', action: 'view' }))
          router
            .get('audit/reservations', [controllers.Reservations, 'auditLogsAll'])
            .use(middleware.permission({ module: 'audit', action: 'view' }))
          router
            .get('audit/commerce', [controllers.CommerceAuditLogs, 'index'])
            .use(middleware.permission({ module: 'audit', action: 'view' }))
        })

        // Caja del complejo: una sola, secuencial. Se abre al empezar el turno y se
        // cierra al terminarlo; mientras está cerrada, los ocho endpoints que mueven
        // plata devuelven 409 (ver middleware.cashRegister más arriba).
        //
        // Tres verbos y no cuatro: `view` es ver el turno y el historial, `create` es
        // ABRIR y `update` es CERRAR. Sin `erase` — un cierre de caja es un hecho.
        router.group(() => {
          router
            .get('cash-register/current', [controllers.CashRegister, 'current'])
            .use(middleware.permission({ module: 'cash_register', action: 'view' }))
          router
            .get('cash-register/sessions', [controllers.CashRegister, 'index'])
            .use(middleware.permission({ module: 'cash_register', action: 'view' }))
          router
            .get('cash-register/sessions/:id', [controllers.CashRegister, 'show'])
            .use(middleware.permission({ module: 'cash_register', action: 'view' }))
          router
            .post('cash-register/open', [controllers.CashRegister, 'open'])
            .use(middleware.permission({ module: 'cash_register', action: 'create' }))
          router
            .post('cash-register/close', [controllers.CashRegister, 'close'])
            .use(middleware.permission({ module: 'cash_register', action: 'update' }))
          // Cierra el turno vencido y abre el que corre, en UNA transacción. Necesita
          // los dos permisos: es un cierre y una apertura, no una operación aparte.
          router
            .post('cash-register/rotate', [controllers.CashRegister, 'rotate'])
            .use(middleware.permission({ module: 'cash_register', action: 'update' }))
            .use(middleware.permission({ module: 'cash_register', action: 'create' }))

          // Fajos: efectivo retirado del cajón durante el turno. Llevan
          // `middleware.cashRegister()` como los otros movimientos de plata — no se
          // retira un fajo de una caja cerrada, ni del turno equivocado — y `update`,
          // el mismo verbo que cerrar: quien arquea el cajón es quien retira los fajos.
          router
            .post('cash-register/bundles', [controllers.CashRegister, 'storeBundle'])
            .use(middleware.permission({ module: 'cash_register', action: 'update' }))
            .use(middleware.cashRegister())
          router
            .post('cash-register/bundles/:id/cancel', [controllers.CashRegister, 'cancelBundle'])
            .use(middleware.permission({ module: 'cash_register', action: 'update' }))
            .use(middleware.cashRegister())
        })
      })
      .use(middleware.auth())
      .use(middleware.profileComplete())
  })
  .prefix('/api/v1')
