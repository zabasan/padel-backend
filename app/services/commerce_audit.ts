import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import CommerceAuditLog, {
  type CommerceAuditAction,
  type CommerceEntityType,
} from '#models/commerce_audit_log'

/**
 * The single writer for commerce_audit_logs. Every product, category and sale mutation goes
 * through here so the audit trail cannot be forgotten in one controller and remembered in
 * another.
 */

export interface AuditChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

/**
 * PURE — no DB, unit-testable on its own (tests/unit/commerce_audit_diff.spec.ts).
 *
 * Emits one change per field that actually MOVED. Comparison is on the stringified values, not
 * the raw ones: MySQL hands DECIMAL back as a string and a form posts numbers, so `1000` vs
 * `"1000.00"` is the normal shape of "unchanged" and must not be logged as an edit. An audit
 * log that records non-edits is one nobody reads.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[]
): AuditChange[] {
  const changes: AuditChange[] = []

  for (const field of fields) {
    if (!(field in after)) continue

    const oldValue = normalize(before[field])
    const newValue = normalize(after[field])
    if (oldValue === newValue) continue

    changes.push({ field, oldValue, newValue })
  }

  return changes
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(round2(value))
  // Numeric strings are compared as numbers so "1000.00" and "1000" are the same value.
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return String(round2(Number(value)))
  }
  return String(value)
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface AuditContext {
  performedBy: number | null
  entityType: CommerceEntityType
  entityId: number
  entityLabel: string
  action: CommerceAuditAction
  trx?: TransactionClientContract
}

/**
 * Writes one row per change. A `create`, `delete` or `cancel` carries no field diff, so it
 * writes a single row with a null field — the action alone is the fact being recorded.
 *
 * An `update` with an empty diff writes NOTHING. Opening a product, touching no field and
 * hitting Guardar is not an event, and the null-field fallback below would otherwise log it as
 * one. The guard lives here rather than at each call site so no future caller can forget it.
 */
export async function logCommerce(
  context: AuditContext,
  changes: AuditChange[] = []
): Promise<void> {
  if (context.action === 'update' && changes.length === 0) return

  const base = {
    performedBy: context.performedBy,
    entityType: context.entityType,
    entityId: context.entityId,
    entityLabel: context.entityLabel.slice(0, 150),
    action: context.action,
  }

  const rows =
    changes.length > 0
      ? changes.map((change) => ({ ...base, ...change }))
      : [{ ...base, field: null, oldValue: null, newValue: null }]

  if (context.trx) {
    // createMany does not accept a client the way create() does, so the rows are attached to
    // the transaction one by one. A sale writes at most a handful.
    for (const row of rows) {
      const log = new CommerceAuditLog()
      log.useTransaction(context.trx)
      log.merge(row)
      await log.save()
    }
    return
  }

  await CommerceAuditLog.createMany(rows)
}

/** Fields of a product worth auditing. Stock is absent on purpose: it moves only through
 * stock_movements, which is already a richer ledger than this table could be. */
export const PRODUCT_AUDITED_FIELDS = [
  'name',
  'categoryId',
  'sku',
  'price',
  'cost',
  'minStock',
  'trackStock',
  'isActive',
]
