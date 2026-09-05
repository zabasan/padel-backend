/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  newAccount: {
    store: typeof routes['new_account.store']
  }
  accessTokens: {
    store: typeof routes['access_tokens.store']
    destroy: typeof routes['access_tokens.destroy']
  }
  settings: {
    show: typeof routes['settings.show']
    update: typeof routes['settings.update']
  }
  courts: {
    index: typeof routes['courts.index']
    show: typeof routes['courts.show']
    store: typeof routes['courts.store']
    update: typeof routes['courts.update']
    destroy: typeof routes['courts.destroy']
    toggleActive: typeof routes['courts.toggle_active']
    updatePriceRanges: typeof routes['courts.update_price_ranges']
  }
  reservations: {
    availability: typeof routes['reservations.availability']
    index: typeof routes['reservations.index']
    next: typeof routes['reservations.next']
    show: typeof routes['reservations.show']
    store: typeof routes['reservations.store']
    update: typeof routes['reservations.update']
    destroy: typeof routes['reservations.destroy']
    updateNotes: typeof routes['reservations.update_notes']
    hideNext: typeof routes['reservations.hide_next']
    updatePromo: typeof routes['reservations.update_promo']
    showNext: typeof routes['reservations.show_next']
    payDeposit: typeof routes['reservations.pay_deposit']
    payTotal: typeof routes['reservations.pay_total']
    settleDebt: typeof routes['reservations.settle_debt']
    auditLogs: typeof routes['reservations.audit_logs']
    revert: typeof routes['reservations.revert']
    revertPayment: typeof routes['reservations.revert_payment']
    revertAllPayments: typeof routes['reservations.revert_all_payments']
    auditLogsAll: typeof routes['reservations.audit_logs_all']
  }
  guestReservations: {
    store: typeof routes['guest_reservations.store']
  }
  profile: {
    show: typeof routes['profile.show']
  }
  completeProfile: {
    store: typeof routes['complete_profile.store']
  }
  productCategories: {
    index: typeof routes['product_categories.index']
    store: typeof routes['product_categories.store']
    update: typeof routes['product_categories.update']
    destroy: typeof routes['product_categories.destroy']
  }
  products: {
    catalog: typeof routes['products.catalog']
    index: typeof routes['products.index']
    show: typeof routes['products.show']
    movements: typeof routes['products.movements']
    store: typeof routes['products.store']
    update: typeof routes['products.update']
    toggleActive: typeof routes['products.toggle_active']
    adjustStock: typeof routes['products.adjust_stock']
    destroy: typeof routes['products.destroy']
  }
  sales: {
    index: typeof routes['sales.index']
    show: typeof routes['sales.show']
    store: typeof routes['sales.store']
    destroy: typeof routes['sales.destroy']
  }
  expenseCategories: {
    index: typeof routes['expense_categories.index']
    store: typeof routes['expense_categories.store']
    update: typeof routes['expense_categories.update']
    destroy: typeof routes['expense_categories.destroy']
  }
  expenses: {
    index: typeof routes['expenses.index']
    show: typeof routes['expenses.show']
    store: typeof routes['expenses.store']
    update: typeof routes['expenses.update']
    destroy: typeof routes['expenses.destroy']
  }
  users: {
    store: typeof routes['users.store']
    index: typeof routes['users.index']
    search: typeof routes['users.search']
    show: typeof routes['users.show']
    update: typeof routes['users.update']
    resetLogin: typeof routes['users.reset_login']
    toggleStatus: typeof routes['users.toggle_status']
    destroy: typeof routes['users.destroy']
  }
  userPermissions: {
    show: typeof routes['user_permissions.show']
    update: typeof routes['user_permissions.update']
  }
  roles: {
    index: typeof routes['roles.index']
    modules: typeof routes['roles.modules']
    show: typeof routes['roles.show']
    store: typeof routes['roles.store']
    update: typeof routes['roles.update']
    destroy: typeof routes['roles.destroy']
  }
  stats: {
    index: typeof routes['stats.index']
  }
  userAuditLogs: {
    index: typeof routes['user_audit_logs.index']
  }
  commerceAuditLogs: {
    index: typeof routes['commerce_audit_logs.index']
  }
  cashRegister: {
    current: typeof routes['cash_register.current']
    index: typeof routes['cash_register.index']
    show: typeof routes['cash_register.show']
    open: typeof routes['cash_register.open']
    close: typeof routes['cash_register.close']
    rotate: typeof routes['cash_register.rotate']
    storeBundle: typeof routes['cash_register.store_bundle']
    cancelBundle: typeof routes['cash_register.cancel_bundle']
  }
}
