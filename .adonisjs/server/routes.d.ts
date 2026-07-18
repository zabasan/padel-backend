import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'access_tokens.store': { paramsTuple?: []; params?: {} }
    'settings.show': { paramsTuple?: []; params?: {} }
    'courts.index': { paramsTuple?: []; params?: {} }
    'reservations.availability': { paramsTuple?: []; params?: {} }
    'courts.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guest_reservations.store': { paramsTuple?: []; params?: {} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'complete_profile.store': { paramsTuple?: []; params?: {} }
    'courts.store': { paramsTuple?: []; params?: {} }
    'courts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courts.toggle_active': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courts.update_price_ranges': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.index': { paramsTuple?: []; params?: {} }
    'reservations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.store': { paramsTuple?: []; params?: {} }
    'reservations.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.hide_next': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.show_next': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.pay_deposit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.pay_total': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.increment_games': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.audit_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.revert': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.revert_payment': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'paymentId': ParamValue} }
    'reservations.revert_all_payments': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.store': { paramsTuple?: []; params?: {} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.search': { paramsTuple?: []; params?: {} }
    'users.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.reset_login': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.toggle_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stats.index': { paramsTuple?: []; params?: {} }
    'settings.update': { paramsTuple?: []; params?: {} }
    'user_audit_logs.index': { paramsTuple?: []; params?: {} }
    'reservations.audit_logs_all': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'settings.show': { paramsTuple?: []; params?: {} }
    'courts.index': { paramsTuple?: []; params?: {} }
    'reservations.availability': { paramsTuple?: []; params?: {} }
    'courts.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'reservations.index': { paramsTuple?: []; params?: {} }
    'reservations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.audit_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.search': { paramsTuple?: []; params?: {} }
    'users.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stats.index': { paramsTuple?: []; params?: {} }
    'user_audit_logs.index': { paramsTuple?: []; params?: {} }
    'reservations.audit_logs_all': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'settings.show': { paramsTuple?: []; params?: {} }
    'courts.index': { paramsTuple?: []; params?: {} }
    'reservations.availability': { paramsTuple?: []; params?: {} }
    'courts.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profile.show': { paramsTuple?: []; params?: {} }
    'reservations.index': { paramsTuple?: []; params?: {} }
    'reservations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.audit_logs': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.index': { paramsTuple?: []; params?: {} }
    'users.search': { paramsTuple?: []; params?: {} }
    'users.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'stats.index': { paramsTuple?: []; params?: {} }
    'user_audit_logs.index': { paramsTuple?: []; params?: {} }
    'reservations.audit_logs_all': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'access_tokens.store': { paramsTuple?: []; params?: {} }
    'guest_reservations.store': { paramsTuple?: []; params?: {} }
    'access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'courts.store': { paramsTuple?: []; params?: {} }
    'reservations.store': { paramsTuple?: []; params?: {} }
    'users.store': { paramsTuple?: []; params?: {} }
    'users.reset_login': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'complete_profile.store': { paramsTuple?: []; params?: {} }
    'courts.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courts.update_price_ranges': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'settings.update': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
    'courts.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.revert_payment': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'paymentId': ParamValue} }
    'reservations.revert_all_payments': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PATCH: {
    'courts.toggle_active': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.hide_next': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.show_next': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.pay_deposit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.pay_total': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.increment_games': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reservations.revert': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.toggle_status': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}