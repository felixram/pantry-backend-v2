// ============================================================================
// SINGLE SOURCE OF TRUTH FOR SUPPORTED CURRENCIES
//
// This file is mirrored at v2/src/lib/currency.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
// ============================================================================

export interface CurrencyInfo {
  code: string
  symbol: string
  name: string
}

// Practical shortlist — the currencies a small-business inventory tenant is
// realistically billed in. Not the full ISO 4217 set; extend here when a
// real tenant needs one.
export const SUPPORTED_CURRENCIES: readonly CurrencyInfo[] = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CNY", symbol: "CN¥", name: "Chinese Yuan" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
]

export const DEFAULT_CURRENCY = "USD"

const SUPPORTED_CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code))

// Common symbol / loose-text spellings Gemini or a human might enter,
// mapped to an ISO code. Only unambiguous ones — bare "$" is treated as USD
// because that is overwhelmingly what it means for this app's tenants.
const SYMBOL_ALIASES: Record<string, string> = {
  $: "USD",
  US$: "USD",
  USD$: "USD",
  DOLLAR: "USD",
  DOLLARS: "USD",
  "€": "EUR",
  EURO: "EUR",
  EUROS: "EUR",
  "£": "GBP",
  POUND: "GBP",
  POUNDS: "GBP",
  C$: "CAD",
  CA$: "CAD",
  CAD$: "CAD",
  A$: "AUD",
  AU$: "AUD",
  AUD$: "AUD",
  MX$: "MXN",
  "₹": "INR",
  RS: "INR",
  "R$": "BRL",
  NZ$: "NZD",
  "S$": "SGD",
  HK$: "HKD",
  FR: "CHF",
  KR: "SEK",
}

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CODES.has(code)
}

/**
 * Coerce arbitrary currency text (an ISO code in any case, a symbol, a
 * loose spelling) to a supported ISO 4217 code, or `null` if it can't be
 * confidently resolved. Callers fall back to the tenant default on `null`.
 */
export function normalizeCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === "") return null

  const upper = trimmed.toUpperCase()
  if (SUPPORTED_CODES.has(upper)) return upper

  const alias = SYMBOL_ALIASES[upper] ?? SYMBOL_ALIASES[trimmed]
  if (alias) return alias

  // "USD - US Dollar", "EUR (Euro)" etc. — take a leading 3-letter token.
  const leading = upper.match(/^[A-Z]{3}/)?.[0]
  if (leading && SUPPORTED_CODES.has(leading)) return leading

  return null
}

/** The display symbol for a code, or the code itself if unknown. */
export function currencySymbol(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.symbol ?? code
}
