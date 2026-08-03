// ============================================================================
// SINGLE SOURCE OF TRUTH FOR DISCOUNT MATH
//
// This file is mirrored at client/src/lib/discountMath.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
//
// Scope: applying a discount % to a unit price, computing a line total with
// a discount applied, and inferring a discount % from an observed line total.
// Tax, shipping, and PO subtotal math live elsewhere (see poTotals.ts).
// ============================================================================

import { moneyEquals, roundToCent } from "./money.ts"

/**
 * Tolerance (in whole cents) below which an invoice line total mismatch is
 * treated as floating-point / rounding noise rather than a real discount.
 * Matches the historical 0.02 threshold used in geminiService.ts.
 */
export const DISCOUNT_TOLERANCE_CENTS = 2

/**
 * Internal: coerce a discount percent into a sane [0, 100] range. NaN /
 * null / undefined / non-finite all collapse to 0. Negative discounts (i.e.
 * surcharges) are intentionally not supported here — callers that want that
 * semantic should compute it directly so the intent is visible at the site.
 */
function normalizeDiscountPercent(
  discountPercent: number | null | undefined,
): number {
  if (discountPercent == null) return 0
  if (!Number.isFinite(discountPercent)) return 0
  if (discountPercent < 0) return 0
  if (discountPercent > 100) return 100
  return discountPercent
}

/**
 * Apply a discount percent to a unit price, returning the discounted unit
 * price rounded to the nearest cent.
 *
 *   applyDiscount(10, 25) === 7.5
 *   applyDiscount(10, 0)  === 10
 *   applyDiscount(10, 100) === 0
 *
 * Out-of-range or non-finite discounts are clamped to [0, 100]; null /
 * undefined are treated as 0.
 */
export function applyDiscount(
  unitPrice: number,
  discountPercent: number | null | undefined,
): number {
  if (!Number.isFinite(unitPrice)) return 0
  const pct = normalizeDiscountPercent(discountPercent)
  return roundToCent(unitPrice * (1 - pct / 100))
}

/**
 * The canonical "what does this line actually cost" function: qty times the
 * discounted unit price, rounded to the nearest cent.
 *
 * Use this anywhere you'd otherwise write `qty * unitPrice * (1 - disc/100)`.
 */
export function lineTotalWithDiscount(
  qty: number,
  unitPrice: number,
  discountPercent: number | null | undefined,
): number {
  if (!Number.isFinite(qty)) return 0
  return roundToCent(qty * applyDiscount(unitPrice, discountPercent))
}

/**
 * Given a qty, an undiscounted unit price, and what the invoice actually
 * charged for the line, back out the discount % that explains the gap.
 *
 * Returns the discount as a percentage rounded to 2 decimals (e.g. 12.5),
 * or `null` if no sane discount in [0, 100] explains the observation
 * (negative inputs, zero/negative qty or price, observed > expected, or
 * any non-finite input).
 */
export function inferDiscountPercent(args: {
  qty: number
  unitPrice: number
  observedLineTotal: number
}): number | null {
  const { qty, unitPrice, observedLineTotal } = args
  if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) return null
  if (!Number.isFinite(observedLineTotal)) return null
  if (qty <= 0 || unitPrice <= 0 || observedLineTotal < 0) return null

  const expected = qty * unitPrice
  if (expected <= 0) return null

  const rawPercent = (1 - observedLineTotal / expected) * 100
  // Tiny FP tolerance so 100.0000000001 still rounds to 100 cleanly.
  const FP_EPSILON = 1e-6
  if (rawPercent < -FP_EPSILON) return null
  if (rawPercent > 100 + FP_EPSILON) return null

  const clamped = Math.min(100, Math.max(0, rawPercent))
  return Math.round(clamped * 100) / 100
}

/**
 * Does the discounted line total match what the invoice actually charged,
 * within tolerance? Uses `moneyEquals` so comparison happens in integer
 * cents and isn't fooled by floating-point dust.
 *
 * Default tolerance is `DISCOUNT_TOLERANCE_CENTS` (2 cents), matching the
 * historical threshold in geminiService.ts.
 */
export function isLineTotalConsistent(args: {
  qty: number
  unitPrice: number
  discountPercent: number | null | undefined
  observedLineTotal: number
  toleranceCents?: number
}): boolean {
  const {
    qty,
    unitPrice,
    discountPercent,
    observedLineTotal,
    toleranceCents = DISCOUNT_TOLERANCE_CENTS,
  } = args
  const expected = lineTotalWithDiscount(qty, unitPrice, discountPercent)
  return moneyEquals(expected, observedLineTotal, toleranceCents)
}
