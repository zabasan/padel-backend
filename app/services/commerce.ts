import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type Product from '#models/product'
import StockMovement, { type StockMovementType } from '#models/stock_movement'

/**
 * Commerce arithmetic and the single stock-writing chokepoint.
 *
 * Everything above `applyStockMovement` is PURE — no DB, unit-testable on its
 * own (tests/unit/commerce_totals.spec.ts), mirroring how permissions.ts keeps
 * mergePermissionRows pure and separate from its resolvers.
 */

/** Money is decimal(10,2) everywhere in this schema. Round once, at the edges. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface SaleLineInput {
  unitPrice: number
  quantity: number
}

export function lineSubtotal(line: SaleLineInput): number {
  return round2(line.unitPrice * line.quantity)
}

export function saleTotal(lines: SaleLineInput[]): number {
  return round2(lines.reduce((sum, line) => sum + lineSubtotal(line), 0))
}

export interface PaymentSplit {
  efectivo: number
  transferencia: number
  postnet: number
}

export function paymentSum(split: PaymentSplit): number {
  return round2(split.efectivo + split.transferencia + split.postnet)
}

/**
 * A one-cent tolerance, not zero: the client adds up the same decimals in
 * floating point and can land a hair off. Anything wider would let a real
 * miscount through.
 */
export function paymentMatchesTotal(total: number, split: PaymentSplit): boolean {
  // The difference is rounded before comparing, not just the operands: raw
  // `Math.abs(99.99 - 100)` is 0.010000000000005, which fails a `<= 0.01` test
  // and would reject exactly the one-cent drift this tolerance exists for.
  return round2(Math.abs(paymentSum(split) - round2(total))) <= 0.01
}

/** Signed delta a movement of `type` applies for a positive `quantity`. */
export function signedDelta(type: StockMovementType, quantity: number): number {
  switch (type) {
    case 'in':
    case 'return':
      return Math.abs(quantity)
    case 'out':
    case 'sale':
      return -Math.abs(quantity)
    case 'adjustment':
      // The only type that takes the caller's sign as given: a physical count
      // correction can go either way.
      return quantity
  }
}

export class InsufficientStockError extends Error {
  constructor(
    public productName: string,
    public available: number,
    public requested: number
  ) {
    super(`Stock insuficiente de "${productName}": hay ${available}, se piden ${requested}`)
  }
}

/**
 * THE only place `products.stock` is written. Takes an already-locked product
 * row and a transaction — callers are responsible for `forUpdate()` and for the
 * transaction itself, because a sale locks every line before touching any of
 * them (see sales_controller.store).
 *
 * Writes the ledger row and the running total together, so the two can never
 * drift apart.
 */
export async function applyStockMovement(
  trx: TransactionClientContract,
  product: Product,
  options: {
    type: StockMovementType
    quantity: number
    performedBy: number
    reason?: string | null
    saleId?: number | null
  }
): Promise<StockMovement> {
  const delta = signedDelta(options.type, options.quantity)
  const stockBefore = product.stock
  const stockAfter = stockBefore + delta

  if (product.trackStock && stockAfter < 0) {
    throw new InsufficientStockError(product.name, stockBefore, Math.abs(delta))
  }

  if (product.trackStock) {
    product.useTransaction(trx)
    product.stock = stockAfter
    await product.save()
  }

  const movement = new StockMovement()
  movement.useTransaction(trx)
  movement.merge({
    productId: product.id,
    type: options.type,
    quantity: delta,
    stockBefore,
    stockAfter: product.trackStock ? stockAfter : stockBefore,
    reason: options.reason ?? null,
    saleId: options.saleId ?? null,
    performedBy: options.performedBy,
  })
  await movement.save()

  return movement
}
