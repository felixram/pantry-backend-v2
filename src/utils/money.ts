// ============================================================================
// SINGLE SOURCE OF TRUTH FOR MONEY MATH
//
// This file is mirrored at client/src/lib/money.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
// ============================================================================

/**
 * Internal: round a money amount to integer cents.
 * The `+ Number.EPSILON` term pushes values like 1.005 (which JS actually
 * stores as 1.00499999…) over the rounding boundary so they land on the
 * expected 101 instead of 100.
 *
 * Returns 0 for non-finite inputs so totals don't silently propagate NaN.
 */
function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  const sign = amount < 0 ? -1 : 1
  return sign * Math.round((Math.abs(amount) + Number.EPSILON) * 100)
}

/**
 * Round a money amount to the nearest cent (2 decimal places).
 *
 * Use this any time you persist or display a computed money value so that
 * floating-point error doesn't surface as $0.01 drift between, e.g., an
 * invoice total and the PO total it's matched against.
 *
 * Rounds half away from zero, which matches what most accounting systems do
 * (and what humans expect when they see 0.005 round to 0.01). Returns 0 for
 * non-finite inputs.
 */
export function roundToCent(amount: number): number {
  return toCents(amount) / 100
}

/**
 * Compare two money amounts for equality within a tolerance, measured in
 * whole cents. Works in integer cents internally so floating-point error
 * after the round can't make two amounts look unequal.
 *
 * Use a larger `toleranceCents` when comparing aggregates of many lines,
 * where rounding error can accumulate (e.g. 2-3 cents per ~50 lines).
 */
export function moneyEquals(
  a: number,
  b: number,
  toleranceCents = 1,
): boolean {
  return Math.abs(toCents(a) - toCents(b)) <= toleranceCents
}
