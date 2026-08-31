// ============================================================================
// SINGLE SOURCE OF TRUTH FOR MONEY FORMATTING
//
// This file is mirrored at v2/src/lib/formatMoney.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
//
// Display only — the math lives in money.ts. Every place that shows a money
// value to a user should go through here so currency symbol and decimal
// style stay consistent across the app.
// ============================================================================

export interface FormatMoneyOptions {
  /** Drop the cents — the style dashboards and reports use for headline figures. */
  whole?: boolean
}

/**
 * Format an amount as currency. Falls back to a bare number string if the
 * currency code is somehow not something Intl accepts, so a bad code never
 * throws in the render path. Non-finite amounts render as zero.
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined = "USD",
  opts: FormatMoneyOptions = {},
): string {
  const value = Number.isFinite(amount) ? amount : 0
  const fractionDigits = opts.whole ? 0 : 2
  const code = currency || "USD"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value)
  } catch {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value)
  }
}
