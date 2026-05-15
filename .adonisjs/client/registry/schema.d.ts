/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'new_account.store': {
    methods: ["POST"]
    pattern: '/api/v1/auth/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'access_tokens.store': {
    methods: ["POST"]
    pattern: '/api/v1/auth/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>>
    }
  }
  'settings.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/settings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['show']>>>
    }
  }
  'courts.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/courts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['index']>>>
    }
  }
  'reservations.availability': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/courts/availability'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['availability']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['availability']>>>
    }
  }
  'courts.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/courts/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['show']>>>
    }
  }
  'guest_reservations.store': {
    methods: ["POST"]
    pattern: '/api/v1/guest/reservations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guest_reservations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guest_reservations_controller').default['store']>>>
    }
  }
  'profile.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
    }
  }
  'access_tokens.destroy': {
    methods: ["POST"]
    pattern: '/api/v1/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
    }
  }
  'courts.store': {
    methods: ["POST"]
    pattern: '/api/v1/courts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['store']>>>
    }
  }
  'courts.update': {
    methods: ["PUT"]
    pattern: '/api/v1/courts/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['update']>>>
    }
  }
  'courts.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/courts/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['destroy']>>>
    }
  }
  'courts.toggle_active': {
    methods: ["PATCH"]
    pattern: '/api/v1/courts/:id/toggle'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['toggleActive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['toggleActive']>>>
    }
  }
  'courts.update_price_ranges': {
    methods: ["PUT"]
    pattern: '/api/v1/courts/:id/price-ranges'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['updatePriceRanges']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courts_controller').default['updatePriceRanges']>>>
    }
  }
  'reservations.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/reservations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['index']>>>
    }
  }
  'reservations.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/reservations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['show']>>>
    }
  }
  'reservations.store': {
    methods: ["POST"]
    pattern: '/api/v1/reservations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['store']>>>
    }
  }
  'reservations.update': {
    methods: ["PUT"]
    pattern: '/api/v1/reservations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['update']>>>
    }
  }
  'reservations.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/reservations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['destroy']>>>
    }
  }
  'reservations.hide_next': {
    methods: ["PATCH"]
    pattern: '/api/v1/reservations/:id/hide-next'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['hideNext']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['hideNext']>>>
    }
  }
  'reservations.show_next': {
    methods: ["PATCH"]
    pattern: '/api/v1/reservations/:id/show-next'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['showNext']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['showNext']>>>
    }
  }
  'reservations.pay_deposit': {
    methods: ["PATCH"]
    pattern: '/api/v1/reservations/:id/pay-deposit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['payDeposit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['payDeposit']>>>
    }
  }
  'reservations.pay_total': {
    methods: ["PATCH"]
    pattern: '/api/v1/reservations/:id/pay-total'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['payTotal']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['payTotal']>>>
    }
  }
  'reservations.increment_games': {
    methods: ["PATCH"]
    pattern: '/api/v1/reservations/:id/increment-games'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['incrementGames']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['incrementGames']>>>
    }
  }
  'reservations.audit_logs': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/reservations/:id/audit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['auditLogs']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['auditLogs']>>>
    }
  }
  'reservations.revert': {
    methods: ["PATCH"]
    pattern: '/api/v1/reservations/:id/revert'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['revert']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['revert']>>>
    }
  }
  'users.store': {
    methods: ["POST"]
    pattern: '/api/v1/users'
    types: {
      body: ExtractBody<InferInput<(typeof import('@vinejs/vine').default)['compile']>|InferInput<(typeof import('@vinejs/vine').default)['object']>|InferInput<(typeof import('@vinejs/vine').default)['string()']['trim']>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('@vinejs/vine').default)['compile']>|InferInput<(typeof import('@vinejs/vine').default)['object']>|InferInput<(typeof import('@vinejs/vine').default)['string()']['trim']>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'users.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/users'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
    }
  }
  'users.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/users/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['show']>>>
    }
  }
  'users.update': {
    methods: ["PUT"]
    pattern: '/api/v1/users/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>>
    }
  }
  'users.reset_login': {
    methods: ["POST"]
    pattern: '/api/v1/users/:id/reset-login'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['resetLogin']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['resetLogin']>>>
    }
  }
  'users.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/users/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['destroy']>>>
    }
  }
  'stats.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/stats'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/stats_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/stats_controller').default['index']>>>
    }
  }
  'settings.update': {
    methods: ["PUT"]
    pattern: '/api/v1/settings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/settings_controller').default['update']>>>
    }
  }
  'user_audit_logs.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/audit/users'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_audit_logs_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_audit_logs_controller').default['index']>>>
    }
  }
  'reservations.audit_logs_all': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/audit/reservations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['auditLogsAll']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reservations_controller').default['auditLogsAll']>>>
    }
  }
}
