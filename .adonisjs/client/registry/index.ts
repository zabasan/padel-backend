/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'new_account.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/signup',
    tokens: [{"old":"/api/v1/auth/signup","type":0,"val":"api","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['new_account.store']['types'],
  },
  'access_tokens.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/login',
    tokens: [{"old":"/api/v1/auth/login","type":0,"val":"api","end":""},{"old":"/api/v1/auth/login","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/login","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['access_tokens.store']['types'],
  },
  'settings.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/settings',
    tokens: [{"old":"/api/v1/settings","type":0,"val":"api","end":""},{"old":"/api/v1/settings","type":0,"val":"v1","end":""},{"old":"/api/v1/settings","type":0,"val":"settings","end":""}],
    types: placeholder as Registry['settings.show']['types'],
  },
  'courts.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/courts',
    tokens: [{"old":"/api/v1/courts","type":0,"val":"api","end":""},{"old":"/api/v1/courts","type":0,"val":"v1","end":""},{"old":"/api/v1/courts","type":0,"val":"courts","end":""}],
    types: placeholder as Registry['courts.index']['types'],
  },
  'reservations.availability': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/courts/availability',
    tokens: [{"old":"/api/v1/courts/availability","type":0,"val":"api","end":""},{"old":"/api/v1/courts/availability","type":0,"val":"v1","end":""},{"old":"/api/v1/courts/availability","type":0,"val":"courts","end":""},{"old":"/api/v1/courts/availability","type":0,"val":"availability","end":""}],
    types: placeholder as Registry['reservations.availability']['types'],
  },
  'courts.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/courts/:id',
    tokens: [{"old":"/api/v1/courts/:id","type":0,"val":"api","end":""},{"old":"/api/v1/courts/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/courts/:id","type":0,"val":"courts","end":""},{"old":"/api/v1/courts/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['courts.show']['types'],
  },
  'guest_reservations.store': {
    methods: ["POST"],
    pattern: '/api/v1/guest/reservations',
    tokens: [{"old":"/api/v1/guest/reservations","type":0,"val":"api","end":""},{"old":"/api/v1/guest/reservations","type":0,"val":"v1","end":""},{"old":"/api/v1/guest/reservations","type":0,"val":"guest","end":""},{"old":"/api/v1/guest/reservations","type":0,"val":"reservations","end":""}],
    types: placeholder as Registry['guest_reservations.store']['types'],
  },
  'profile.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/profile',
    tokens: [{"old":"/api/v1/profile","type":0,"val":"api","end":""},{"old":"/api/v1/profile","type":0,"val":"v1","end":""},{"old":"/api/v1/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['profile.show']['types'],
  },
  'access_tokens.destroy': {
    methods: ["POST"],
    pattern: '/api/v1/logout',
    tokens: [{"old":"/api/v1/logout","type":0,"val":"api","end":""},{"old":"/api/v1/logout","type":0,"val":"v1","end":""},{"old":"/api/v1/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['access_tokens.destroy']['types'],
  },
  'courts.store': {
    methods: ["POST"],
    pattern: '/api/v1/courts',
    tokens: [{"old":"/api/v1/courts","type":0,"val":"api","end":""},{"old":"/api/v1/courts","type":0,"val":"v1","end":""},{"old":"/api/v1/courts","type":0,"val":"courts","end":""}],
    types: placeholder as Registry['courts.store']['types'],
  },
  'courts.update': {
    methods: ["PUT"],
    pattern: '/api/v1/courts/:id',
    tokens: [{"old":"/api/v1/courts/:id","type":0,"val":"api","end":""},{"old":"/api/v1/courts/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/courts/:id","type":0,"val":"courts","end":""},{"old":"/api/v1/courts/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['courts.update']['types'],
  },
  'courts.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/courts/:id',
    tokens: [{"old":"/api/v1/courts/:id","type":0,"val":"api","end":""},{"old":"/api/v1/courts/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/courts/:id","type":0,"val":"courts","end":""},{"old":"/api/v1/courts/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['courts.destroy']['types'],
  },
  'courts.toggle_active': {
    methods: ["PATCH"],
    pattern: '/api/v1/courts/:id/toggle',
    tokens: [{"old":"/api/v1/courts/:id/toggle","type":0,"val":"api","end":""},{"old":"/api/v1/courts/:id/toggle","type":0,"val":"v1","end":""},{"old":"/api/v1/courts/:id/toggle","type":0,"val":"courts","end":""},{"old":"/api/v1/courts/:id/toggle","type":1,"val":"id","end":""},{"old":"/api/v1/courts/:id/toggle","type":0,"val":"toggle","end":""}],
    types: placeholder as Registry['courts.toggle_active']['types'],
  },
  'courts.update_price_ranges': {
    methods: ["PUT"],
    pattern: '/api/v1/courts/:id/price-ranges',
    tokens: [{"old":"/api/v1/courts/:id/price-ranges","type":0,"val":"api","end":""},{"old":"/api/v1/courts/:id/price-ranges","type":0,"val":"v1","end":""},{"old":"/api/v1/courts/:id/price-ranges","type":0,"val":"courts","end":""},{"old":"/api/v1/courts/:id/price-ranges","type":1,"val":"id","end":""},{"old":"/api/v1/courts/:id/price-ranges","type":0,"val":"price-ranges","end":""}],
    types: placeholder as Registry['courts.update_price_ranges']['types'],
  },
  'reservations.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/reservations',
    tokens: [{"old":"/api/v1/reservations","type":0,"val":"api","end":""},{"old":"/api/v1/reservations","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations","type":0,"val":"reservations","end":""}],
    types: placeholder as Registry['reservations.index']['types'],
  },
  'reservations.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/reservations/:id',
    tokens: [{"old":"/api/v1/reservations/:id","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['reservations.show']['types'],
  },
  'reservations.store': {
    methods: ["POST"],
    pattern: '/api/v1/reservations',
    tokens: [{"old":"/api/v1/reservations","type":0,"val":"api","end":""},{"old":"/api/v1/reservations","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations","type":0,"val":"reservations","end":""}],
    types: placeholder as Registry['reservations.store']['types'],
  },
  'reservations.update': {
    methods: ["PUT"],
    pattern: '/api/v1/reservations/:id',
    tokens: [{"old":"/api/v1/reservations/:id","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['reservations.update']['types'],
  },
  'reservations.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/reservations/:id',
    tokens: [{"old":"/api/v1/reservations/:id","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['reservations.destroy']['types'],
  },
  'reservations.hide_next': {
    methods: ["PATCH"],
    pattern: '/api/v1/reservations/:id/hide-next',
    tokens: [{"old":"/api/v1/reservations/:id/hide-next","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/hide-next","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/hide-next","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/hide-next","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/hide-next","type":0,"val":"hide-next","end":""}],
    types: placeholder as Registry['reservations.hide_next']['types'],
  },
  'reservations.pay_deposit': {
    methods: ["PATCH"],
    pattern: '/api/v1/reservations/:id/pay-deposit',
    tokens: [{"old":"/api/v1/reservations/:id/pay-deposit","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/pay-deposit","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/pay-deposit","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/pay-deposit","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/pay-deposit","type":0,"val":"pay-deposit","end":""}],
    types: placeholder as Registry['reservations.pay_deposit']['types'],
  },
  'reservations.pay_total': {
    methods: ["PATCH"],
    pattern: '/api/v1/reservations/:id/pay-total',
    tokens: [{"old":"/api/v1/reservations/:id/pay-total","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/pay-total","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/pay-total","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/pay-total","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/pay-total","type":0,"val":"pay-total","end":""}],
    types: placeholder as Registry['reservations.pay_total']['types'],
  },
  'users.store': {
    methods: ["POST"],
    pattern: '/api/v1/users',
    tokens: [{"old":"/api/v1/users","type":0,"val":"api","end":""},{"old":"/api/v1/users","type":0,"val":"v1","end":""},{"old":"/api/v1/users","type":0,"val":"users","end":""}],
    types: placeholder as Registry['users.store']['types'],
  },
  'users.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/users',
    tokens: [{"old":"/api/v1/users","type":0,"val":"api","end":""},{"old":"/api/v1/users","type":0,"val":"v1","end":""},{"old":"/api/v1/users","type":0,"val":"users","end":""}],
    types: placeholder as Registry['users.index']['types'],
  },
  'users.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/users/:id',
    tokens: [{"old":"/api/v1/users/:id","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['users.show']['types'],
  },
  'users.update': {
    methods: ["PUT"],
    pattern: '/api/v1/users/:id',
    tokens: [{"old":"/api/v1/users/:id","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['users.update']['types'],
  },
  'users.reset_login': {
    methods: ["POST"],
    pattern: '/api/v1/users/:id/reset-login',
    tokens: [{"old":"/api/v1/users/:id/reset-login","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id/reset-login","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id/reset-login","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id/reset-login","type":1,"val":"id","end":""},{"old":"/api/v1/users/:id/reset-login","type":0,"val":"reset-login","end":""}],
    types: placeholder as Registry['users.reset_login']['types'],
  },
  'users.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/users/:id',
    tokens: [{"old":"/api/v1/users/:id","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['users.destroy']['types'],
  },
  'stats.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/stats',
    tokens: [{"old":"/api/v1/stats","type":0,"val":"api","end":""},{"old":"/api/v1/stats","type":0,"val":"v1","end":""},{"old":"/api/v1/stats","type":0,"val":"stats","end":""}],
    types: placeholder as Registry['stats.index']['types'],
  },
  'settings.update': {
    methods: ["PUT"],
    pattern: '/api/v1/settings',
    tokens: [{"old":"/api/v1/settings","type":0,"val":"api","end":""},{"old":"/api/v1/settings","type":0,"val":"v1","end":""},{"old":"/api/v1/settings","type":0,"val":"settings","end":""}],
    types: placeholder as Registry['settings.update']['types'],
  },
  'user_audit_logs.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/audit/users',
    tokens: [{"old":"/api/v1/audit/users","type":0,"val":"api","end":""},{"old":"/api/v1/audit/users","type":0,"val":"v1","end":""},{"old":"/api/v1/audit/users","type":0,"val":"audit","end":""},{"old":"/api/v1/audit/users","type":0,"val":"users","end":""}],
    types: placeholder as Registry['user_audit_logs.index']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
