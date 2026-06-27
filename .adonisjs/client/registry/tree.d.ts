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
    show: typeof routes['reservations.show']
    store: typeof routes['reservations.store']
    update: typeof routes['reservations.update']
    destroy: typeof routes['reservations.destroy']
    hideNext: typeof routes['reservations.hide_next']
    showNext: typeof routes['reservations.show_next']
    payDeposit: typeof routes['reservations.pay_deposit']
    payTotal: typeof routes['reservations.pay_total']
    incrementGames: typeof routes['reservations.increment_games']
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
  users: {
    store: typeof routes['users.store']
    index: typeof routes['users.index']
    show: typeof routes['users.show']
    update: typeof routes['users.update']
    resetLogin: typeof routes['users.reset_login']
    toggleStatus: typeof routes['users.toggle_status']
    destroy: typeof routes['users.destroy']
  }
  stats: {
    index: typeof routes['stats.index']
  }
  userAuditLogs: {
    index: typeof routes['user_audit_logs.index']
  }
}
