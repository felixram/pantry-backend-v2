// ============================================================================
// SINGLE SOURCE OF TRUTH FOR PURCHASE ORDER TOTALS
//
// This file is mirrored at client/src/lib/poTotals.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
//
// Scope: line totals, subtotals, tax, free-shipping fee, and grand total for
// purchase orders. Generic invoice totals (discount math, multi-line VAT
// schemes) are intentionally out of scope and live elsewhere.
//
// Every computed money value returned from this module is passed through
// `roundToCent` so callers don't have to remember to round; sums are rounded
// once at the end (not per line) to match printed-receipt arithmetic.
// ============================================================================

import { roundToCent } from "./money.ts"

/**
 * Minimal PO-item shape needed to compute totals. Intentionally not tied to a
 * Drizzle row type so this module stays usable from the client and from any
 * controller regardless of the relation shape it loaded.
 *
 * - `qty`: line quantity (in the item's purchase unit; this module does no
 *   unit conversion, that's `unitConversion.ts`'s job).
 * - `unit_price`: per-unit price; nullable to tolerate in-progress drafts.
 * - `received_qty`: when the PO has been received, this is what actually
 *   arrived; opt in via the `useReceived` option on the helpers below.
 * - `tax.taxAmount`: pre-computed tax for the line, when callers have already
 *   resolved tax rates. Null/undefined means "don't tax this line."
 * - `tax.isTaxable`: hint flag for callers that want to count taxable lines;
 *   not used by the math itself.
 */
export interface POItemForTotals {
  qty: number
  unit_price: number | null
  received_qty?: number | null
  tax?: {
    taxAmount?: number | null
    isTaxable?: boolean | null
  } | null
}

function safeNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return value
}

function effectiveQty(item: POItemForTotals, useReceived: boolean): number {
  if (useReceived && item.received_qty != null) {
    return safeNumber(item.received_qty)
  }
  return safeNumber(item.qty)
}

/**
 * Line total for a single PO item: `qty * unit_price`, rounded to the cent.
 *
 * Pass `useReceived: true` to substitute `received_qty` when present (used on
 * received POs so the displayed line value matches what was actually
 * delivered). Null/missing fields are treated as 0 so callers don't have to
 * guard every input.
 */
export function calculateLineTotal(
  item: POItemForTotals,
  opts?: { useReceived?: boolean },
): number {
  const qty = effectiveQty(item, opts?.useReceived ?? false)
  const price = safeNumber(item.unit_price)
  return roundToCent(qty * price)
}

/**
 * Subtotal of a list of PO items. Sums the raw products and rounds once at
 * the end — matches how a printed receipt computes its subtotal, and avoids
 * the per-line-then-resum drift that can show up as 1¢ off on long orders.
 */
export function calculateSubtotal(
  items: POItemForTotals[],
  opts?: { useReceived?: boolean },
): number {
  const useReceived = opts?.useReceived ?? false
  let sum = 0
  for (const item of items) {
    const qty = effectiveQty(item, useReceived)
    const price = safeNumber(item.unit_price)
    sum += qty * price
  }
  return roundToCent(sum)
}

/**
 * Sum of pre-computed per-line tax amounts. Returns 0 when no items carry a
 * `tax.taxAmount`. Use this when each line already has a resolved tax (e.g.
 * `getById` has run `resolveApplicableTaxRate` per item).
 */
export function calculateTaxFromItems(items: POItemForTotals[]): number {
  let sum = 0
  for (const item of items) {
    const amount = item.tax?.taxAmount
    if (amount != null && Number.isFinite(amount)) {
      sum += amount
    }
  }
  return roundToCent(sum)
}

/**
 * Tax for a single line, given a percentage rate (e.g. 7.5 for 7.5%).
 * Use this when tax is computed from a rate rather than a pre-extracted
 * per-line amount. Returns 0 for non-finite or non-positive rates.
 */
export function calculateLineTax(lineTotal: number, taxRate: number): number {
  const total = safeNumber(lineTotal)
  const rate = safeNumber(taxRate)
  if (rate <= 0) return 0
  return roundToCent(total * (rate / 100))
}

/**
 * Resolve the supplier shipping fee for a given subtotal. The fee is charged
 * only when both the free-shipping minimum and the flat shipping fee are
 * positive AND the subtotal is below the minimum. Otherwise shipping is free
 * (returns 0). The fee itself is rounded to the cent for display consistency.
 */
export function calculateShippingFee(
  subtotal: number,
  freeShippingMinimum: number | null | undefined,
  shippingFee: number | null | undefined,
): number {
  const sub = safeNumber(subtotal)
  const minimum = safeNumber(freeShippingMinimum)
  const fee = safeNumber(shippingFee)
  if (minimum <= 0 || fee <= 0) return 0
  if (sub >= minimum) return 0
  return roundToCent(fee)
}

/**
 * Grand total = subtotal + tax + shipping, rounded once. Inputs are expected
 * to already be rounded line/subtotal-level values from this module, but
 * non-finite inputs are tolerated and treated as 0.
 */
export function calculateGrandTotal(args: {
  subtotal: number
  tax: number
  shipping: number
}): number {
  return roundToCent(
    safeNumber(args.subtotal) +
      safeNumber(args.tax) +
      safeNumber(args.shipping),
  )
}
