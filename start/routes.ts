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

    // Authenticated routes
    router
      .group(() => {
        // Profile
        router.get('profile', [controllers.Profile, 'show'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])

        // Courts - write only for admin and worker
        router
          .group(() => {
            router.post('courts', [controllers.Courts, 'store'])
            router.put('courts/:id', [controllers.Courts, 'update'])
            router.delete('courts/:id', [controllers.Courts, 'destroy'])
            router.patch('courts/:id/toggle', [controllers.Courts, 'toggleActive'])
            router.put('courts/:id/price-ranges', [controllers.Courts, 'updatePriceRanges'])
          })
          .use(middleware.role({ roles: ['admin', 'worker'] }))

        // Reservations - all authenticated users can CRUD their own
        router.get('reservations', [controllers.Reservations, 'index'])
        router.get('reservations/:id', [controllers.Reservations, 'show'])
        router.post('reservations', [controllers.Reservations, 'store'])
        router.put('reservations/:id', [controllers.Reservations, 'update'])
        router.delete('reservations/:id', [controllers.Reservations, 'destroy'])
        router.patch('reservations/:id/hide-next', [controllers.Reservations, 'hideNext'])
        router.patch('reservations/:id/pay-deposit', [controllers.Reservations, 'payDeposit'])
        router.patch('reservations/:id/pay-total', [controllers.Reservations, 'payTotal'])

        // Users management
        router
          .group(() => {
            router.post('users', [controllers.Users, 'store'])
            router.get('users', [controllers.Users, 'index'])
            router.get('users/:id', [controllers.Users, 'show'])
            router.put('users/:id', [controllers.Users, 'update'])
            router.post('users/:id/reset-login', [controllers.Users, 'resetLogin'])
          })
          .use(middleware.role({ roles: ['admin', 'worker'] }))

        router
          .group(() => {
            router.delete('users/:id', [controllers.Users, 'destroy'])
            router.get('stats', [controllers.Stats, 'index'])
            router.put('settings', [controllers.Settings, 'update'])
            router.get('audit/users', [controllers.UserAuditLogs, 'index'])
          })
          .use(middleware.role({ roles: ['admin'] }))
      })
      .use(middleware.auth())
  })
  .prefix('/api/v1')
