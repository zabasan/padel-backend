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
    pattern: '/api/v1/account/profile',
    tokens: [{"old":"/api/v1/account/profile","type":0,"val":"api","end":""},{"old":"/api/v1/account/profile","type":0,"val":"v1","end":""},{"old":"/api/v1/account/profile","type":0,"val":"account","end":""},{"old":"/api/v1/account/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['profile.show']['types'],
  },
  'access_tokens.destroy': {
    methods: ["POST"],
    pattern: '/api/v1/account/logout',
    tokens: [{"old":"/api/v1/account/logout","type":0,"val":"api","end":""},{"old":"/api/v1/account/logout","type":0,"val":"v1","end":""},{"old":"/api/v1/account/logout","type":0,"val":"account","end":""},{"old":"/api/v1/account/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['access_tokens.destroy']['types'],
  },
  'complete_profile.store': {
    methods: ["PUT"],
    pattern: '/api/v1/account/complete-profile',
    tokens: [{"old":"/api/v1/account/complete-profile","type":0,"val":"api","end":""},{"old":"/api/v1/account/complete-profile","type":0,"val":"v1","end":""},{"old":"/api/v1/account/complete-profile","type":0,"val":"account","end":""},{"old":"/api/v1/account/complete-profile","type":0,"val":"complete-profile","end":""}],
    types: placeholder as Registry['complete_profile.store']['types'],
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
  'reservations.show_next': {
    methods: ["PATCH"],
    pattern: '/api/v1/reservations/:id/show-next',
    tokens: [{"old":"/api/v1/reservations/:id/show-next","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/show-next","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/show-next","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/show-next","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/show-next","type":0,"val":"show-next","end":""}],
    types: placeholder as Registry['reservations.show_next']['types'],
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
  'reservations.audit_logs': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/reservations/:id/audit',
    tokens: [{"old":"/api/v1/reservations/:id/audit","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/audit","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/audit","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/audit","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/audit","type":0,"val":"audit","end":""}],
    types: placeholder as Registry['reservations.audit_logs']['types'],
  },
  'reservations.revert': {
    methods: ["PATCH"],
    pattern: '/api/v1/reservations/:id/revert',
    tokens: [{"old":"/api/v1/reservations/:id/revert","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/revert","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/revert","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/revert","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/revert","type":0,"val":"revert","end":""}],
    types: placeholder as Registry['reservations.revert']['types'],
  },
  'reservations.revert_payment': {
    methods: ["DELETE"],
    pattern: '/api/v1/reservations/:id/payments/:paymentId',
    tokens: [{"old":"/api/v1/reservations/:id/payments/:paymentId","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/payments/:paymentId","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/payments/:paymentId","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/payments/:paymentId","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/payments/:paymentId","type":0,"val":"payments","end":""},{"old":"/api/v1/reservations/:id/payments/:paymentId","type":1,"val":"paymentId","end":""}],
    types: placeholder as Registry['reservations.revert_payment']['types'],
  },
  'reservations.revert_all_payments': {
    methods: ["DELETE"],
    pattern: '/api/v1/reservations/:id/payments',
    tokens: [{"old":"/api/v1/reservations/:id/payments","type":0,"val":"api","end":""},{"old":"/api/v1/reservations/:id/payments","type":0,"val":"v1","end":""},{"old":"/api/v1/reservations/:id/payments","type":0,"val":"reservations","end":""},{"old":"/api/v1/reservations/:id/payments","type":1,"val":"id","end":""},{"old":"/api/v1/reservations/:id/payments","type":0,"val":"payments","end":""}],
    types: placeholder as Registry['reservations.revert_all_payments']['types'],
  },
  'product_categories.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/product-categories',
    tokens: [{"old":"/api/v1/product-categories","type":0,"val":"api","end":""},{"old":"/api/v1/product-categories","type":0,"val":"v1","end":""},{"old":"/api/v1/product-categories","type":0,"val":"product-categories","end":""}],
    types: placeholder as Registry['product_categories.index']['types'],
  },
  'product_categories.store': {
    methods: ["POST"],
    pattern: '/api/v1/product-categories',
    tokens: [{"old":"/api/v1/product-categories","type":0,"val":"api","end":""},{"old":"/api/v1/product-categories","type":0,"val":"v1","end":""},{"old":"/api/v1/product-categories","type":0,"val":"product-categories","end":""}],
    types: placeholder as Registry['product_categories.store']['types'],
  },
  'product_categories.update': {
    methods: ["PUT"],
    pattern: '/api/v1/product-categories/:id',
    tokens: [{"old":"/api/v1/product-categories/:id","type":0,"val":"api","end":""},{"old":"/api/v1/product-categories/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/product-categories/:id","type":0,"val":"product-categories","end":""},{"old":"/api/v1/product-categories/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['product_categories.update']['types'],
  },
  'product_categories.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/product-categories/:id',
    tokens: [{"old":"/api/v1/product-categories/:id","type":0,"val":"api","end":""},{"old":"/api/v1/product-categories/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/product-categories/:id","type":0,"val":"product-categories","end":""},{"old":"/api/v1/product-categories/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['product_categories.destroy']['types'],
  },
  'products.catalog': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/products/catalog',
    tokens: [{"old":"/api/v1/products/catalog","type":0,"val":"api","end":""},{"old":"/api/v1/products/catalog","type":0,"val":"v1","end":""},{"old":"/api/v1/products/catalog","type":0,"val":"products","end":""},{"old":"/api/v1/products/catalog","type":0,"val":"catalog","end":""}],
    types: placeholder as Registry['products.catalog']['types'],
  },
  'products.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/products',
    tokens: [{"old":"/api/v1/products","type":0,"val":"api","end":""},{"old":"/api/v1/products","type":0,"val":"v1","end":""},{"old":"/api/v1/products","type":0,"val":"products","end":""}],
    types: placeholder as Registry['products.index']['types'],
  },
  'products.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/products/:id',
    tokens: [{"old":"/api/v1/products/:id","type":0,"val":"api","end":""},{"old":"/api/v1/products/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/products/:id","type":0,"val":"products","end":""},{"old":"/api/v1/products/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['products.show']['types'],
  },
  'products.movements': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/products/:id/movements',
    tokens: [{"old":"/api/v1/products/:id/movements","type":0,"val":"api","end":""},{"old":"/api/v1/products/:id/movements","type":0,"val":"v1","end":""},{"old":"/api/v1/products/:id/movements","type":0,"val":"products","end":""},{"old":"/api/v1/products/:id/movements","type":1,"val":"id","end":""},{"old":"/api/v1/products/:id/movements","type":0,"val":"movements","end":""}],
    types: placeholder as Registry['products.movements']['types'],
  },
  'products.store': {
    methods: ["POST"],
    pattern: '/api/v1/products',
    tokens: [{"old":"/api/v1/products","type":0,"val":"api","end":""},{"old":"/api/v1/products","type":0,"val":"v1","end":""},{"old":"/api/v1/products","type":0,"val":"products","end":""}],
    types: placeholder as Registry['products.store']['types'],
  },
  'products.update': {
    methods: ["PUT"],
    pattern: '/api/v1/products/:id',
    tokens: [{"old":"/api/v1/products/:id","type":0,"val":"api","end":""},{"old":"/api/v1/products/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/products/:id","type":0,"val":"products","end":""},{"old":"/api/v1/products/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['products.update']['types'],
  },
  'products.toggle_active': {
    methods: ["PATCH"],
    pattern: '/api/v1/products/:id/toggle',
    tokens: [{"old":"/api/v1/products/:id/toggle","type":0,"val":"api","end":""},{"old":"/api/v1/products/:id/toggle","type":0,"val":"v1","end":""},{"old":"/api/v1/products/:id/toggle","type":0,"val":"products","end":""},{"old":"/api/v1/products/:id/toggle","type":1,"val":"id","end":""},{"old":"/api/v1/products/:id/toggle","type":0,"val":"toggle","end":""}],
    types: placeholder as Registry['products.toggle_active']['types'],
  },
  'products.adjust_stock': {
    methods: ["POST"],
    pattern: '/api/v1/products/:id/stock',
    tokens: [{"old":"/api/v1/products/:id/stock","type":0,"val":"api","end":""},{"old":"/api/v1/products/:id/stock","type":0,"val":"v1","end":""},{"old":"/api/v1/products/:id/stock","type":0,"val":"products","end":""},{"old":"/api/v1/products/:id/stock","type":1,"val":"id","end":""},{"old":"/api/v1/products/:id/stock","type":0,"val":"stock","end":""}],
    types: placeholder as Registry['products.adjust_stock']['types'],
  },
  'products.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/products/:id',
    tokens: [{"old":"/api/v1/products/:id","type":0,"val":"api","end":""},{"old":"/api/v1/products/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/products/:id","type":0,"val":"products","end":""},{"old":"/api/v1/products/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['products.destroy']['types'],
  },
  'sales.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/sales',
    tokens: [{"old":"/api/v1/sales","type":0,"val":"api","end":""},{"old":"/api/v1/sales","type":0,"val":"v1","end":""},{"old":"/api/v1/sales","type":0,"val":"sales","end":""}],
    types: placeholder as Registry['sales.index']['types'],
  },
  'sales.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/sales/:id',
    tokens: [{"old":"/api/v1/sales/:id","type":0,"val":"api","end":""},{"old":"/api/v1/sales/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/sales/:id","type":0,"val":"sales","end":""},{"old":"/api/v1/sales/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['sales.show']['types'],
  },
  'sales.store': {
    methods: ["POST"],
    pattern: '/api/v1/sales',
    tokens: [{"old":"/api/v1/sales","type":0,"val":"api","end":""},{"old":"/api/v1/sales","type":0,"val":"v1","end":""},{"old":"/api/v1/sales","type":0,"val":"sales","end":""}],
    types: placeholder as Registry['sales.store']['types'],
  },
  'sales.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/sales/:id',
    tokens: [{"old":"/api/v1/sales/:id","type":0,"val":"api","end":""},{"old":"/api/v1/sales/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/sales/:id","type":0,"val":"sales","end":""},{"old":"/api/v1/sales/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['sales.destroy']['types'],
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
  'users.search': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/users/search',
    tokens: [{"old":"/api/v1/users/search","type":0,"val":"api","end":""},{"old":"/api/v1/users/search","type":0,"val":"v1","end":""},{"old":"/api/v1/users/search","type":0,"val":"users","end":""},{"old":"/api/v1/users/search","type":0,"val":"search","end":""}],
    types: placeholder as Registry['users.search']['types'],
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
  'users.toggle_status': {
    methods: ["PATCH"],
    pattern: '/api/v1/users/:id/toggle-status',
    tokens: [{"old":"/api/v1/users/:id/toggle-status","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id/toggle-status","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id/toggle-status","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id/toggle-status","type":1,"val":"id","end":""},{"old":"/api/v1/users/:id/toggle-status","type":0,"val":"toggle-status","end":""}],
    types: placeholder as Registry['users.toggle_status']['types'],
  },
  'user_permissions.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/users/:id/permissions',
    tokens: [{"old":"/api/v1/users/:id/permissions","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id/permissions","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id/permissions","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id/permissions","type":1,"val":"id","end":""},{"old":"/api/v1/users/:id/permissions","type":0,"val":"permissions","end":""}],
    types: placeholder as Registry['user_permissions.show']['types'],
  },
  'user_permissions.update': {
    methods: ["PUT"],
    pattern: '/api/v1/users/:id/permissions',
    tokens: [{"old":"/api/v1/users/:id/permissions","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id/permissions","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id/permissions","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id/permissions","type":1,"val":"id","end":""},{"old":"/api/v1/users/:id/permissions","type":0,"val":"permissions","end":""}],
    types: placeholder as Registry['user_permissions.update']['types'],
  },
  'roles.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/roles',
    tokens: [{"old":"/api/v1/roles","type":0,"val":"api","end":""},{"old":"/api/v1/roles","type":0,"val":"v1","end":""},{"old":"/api/v1/roles","type":0,"val":"roles","end":""}],
    types: placeholder as Registry['roles.index']['types'],
  },
  'roles.modules': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/modules',
    tokens: [{"old":"/api/v1/modules","type":0,"val":"api","end":""},{"old":"/api/v1/modules","type":0,"val":"v1","end":""},{"old":"/api/v1/modules","type":0,"val":"modules","end":""}],
    types: placeholder as Registry['roles.modules']['types'],
  },
  'roles.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/roles/:id',
    tokens: [{"old":"/api/v1/roles/:id","type":0,"val":"api","end":""},{"old":"/api/v1/roles/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/roles/:id","type":0,"val":"roles","end":""},{"old":"/api/v1/roles/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['roles.show']['types'],
  },
  'roles.store': {
    methods: ["POST"],
    pattern: '/api/v1/roles',
    tokens: [{"old":"/api/v1/roles","type":0,"val":"api","end":""},{"old":"/api/v1/roles","type":0,"val":"v1","end":""},{"old":"/api/v1/roles","type":0,"val":"roles","end":""}],
    types: placeholder as Registry['roles.store']['types'],
  },
  'roles.update': {
    methods: ["PUT"],
    pattern: '/api/v1/roles/:id',
    tokens: [{"old":"/api/v1/roles/:id","type":0,"val":"api","end":""},{"old":"/api/v1/roles/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/roles/:id","type":0,"val":"roles","end":""},{"old":"/api/v1/roles/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['roles.update']['types'],
  },
  'roles.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/roles/:id',
    tokens: [{"old":"/api/v1/roles/:id","type":0,"val":"api","end":""},{"old":"/api/v1/roles/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/roles/:id","type":0,"val":"roles","end":""},{"old":"/api/v1/roles/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['roles.destroy']['types'],
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
  'reservations.audit_logs_all': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/audit/reservations',
    tokens: [{"old":"/api/v1/audit/reservations","type":0,"val":"api","end":""},{"old":"/api/v1/audit/reservations","type":0,"val":"v1","end":""},{"old":"/api/v1/audit/reservations","type":0,"val":"audit","end":""},{"old":"/api/v1/audit/reservations","type":0,"val":"reservations","end":""}],
    types: placeholder as Registry['reservations.audit_logs_all']['types'],
  },
  'commerce_audit_logs.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/audit/commerce',
    tokens: [{"old":"/api/v1/audit/commerce","type":0,"val":"api","end":""},{"old":"/api/v1/audit/commerce","type":0,"val":"v1","end":""},{"old":"/api/v1/audit/commerce","type":0,"val":"audit","end":""},{"old":"/api/v1/audit/commerce","type":0,"val":"commerce","end":""}],
    types: placeholder as Registry['commerce_audit_logs.index']['types'],
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
