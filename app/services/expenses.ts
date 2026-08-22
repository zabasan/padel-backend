import { type PaymentSplit, round2 } from '#services/commerce'

/**
 * Aritmética de gastos. TODO acá es PURO — sin DB, unit-testable por su cuenta
 * (tests/unit/expenses_totals.spec.ts), igual que la mitad de arriba de commerce.ts.
 *
 * `round2`, `paymentSum` y `paymentMatchesTotal` NO se reimplementan: se importan de
 * `#services/commerce`. Son aritmética de plata sobre las mismas tres formas de pago
 * (efectivo / transferencia / postnet), no lógica de comercio, y duplicarlas sería
 * exactamente cómo la tolerancia de un centavo termina siendo distinta en cada tabla.
 */

export interface ExpenseSplitInput {
  efectivo?: number | null
  transferencia?: number | null
  postnet?: number | null
}

/** Normaliza el split que llega del request a los tres números redondeados. */
export function normalizeSplit(input: ExpenseSplitInput): PaymentSplit {
  return {
    efectivo: round2(input.efectivo ?? 0),
    transferencia: round2(input.transferencia ?? 0),
    postnet: round2(input.postnet ?? 0),
  }
}

export interface ExpenseAmountish {
  amount: number
  status?: 'completed' | 'cancelled'
}

/**
 * Suma de gastos, salteando los anulados.
 *
 * El filtro va acá y no en cada call site porque "un gasto anulado no salió de la caja"
 * es la regla, no una opción: un gasto que se anula y sigue restando del neto es un
 * agujero que nadie ve hasta el cierre de mes.
 */
export function expensesTotal(expenses: ExpenseAmountish[]): number {
  return round2(expenses.reduce((sum, e) => (e.status === 'cancelled' ? sum : sum + e.amount), 0))
}

export interface CategorizableExpense extends ExpenseAmountish {
  categoryId: number | null
  categoryName?: string | null
}

export interface ExpenseCategoryTotal {
  categoryId: number | null
  name: string
  total: number
  count: number
}

/**
 * Agrupa por categoría y ordena de mayor a menor gasto — el orden en que se lee la
 * pantalla ("¿en qué se me va la plata?"), no alfabético.
 *
 * Los gastos sin categoría caen todos en un único grupo `categoryId: null` rotulado
 * "Sin categoría": si se descartaran, la suma de la tabla no daría el total de arriba,
 * que es el primer control que hace cualquiera al mirarla.
 */
export function groupExpensesByCategory(expenses: CategorizableExpense[]): ExpenseCategoryTotal[] {
  const groups = new Map<number | null, ExpenseCategoryTotal>()

  for (const expense of expenses) {
    if (expense.status === 'cancelled') continue

    const key = expense.categoryId ?? null
    const existing = groups.get(key)
    if (existing) {
      existing.total = round2(existing.total + expense.amount)
      existing.count += 1
      continue
    }
    groups.set(key, {
      categoryId: key,
      name: expense.categoryName || 'Sin categoría',
      total: round2(expense.amount),
      count: 1,
    })
  }

  return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** Campos de un gasto que vale la pena auditar. `status` va aparte, como acción. */
export const EXPENSE_AUDITED_FIELDS = [
  'description',
  'categoryId',
  'supplier',
  'amount',
  'efectivo',
  'transferencia',
  'postnet',
  'expenseDate',
  'notes',
]
