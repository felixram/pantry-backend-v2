import { and, eq, inArray, isNull } from "drizzle-orm"
import { TaxRate } from "../../db/schema/taxRate.ts"
import { TAX_TYPE } from "../../types/tax.ts"
import type { db as dbType } from "../../db/index.ts"

// A rate implied by a dollar tax_amount rarely lands on an exact configured
// percentage (rounding in the extracted amount, or in the invoice's own
// tax math) — this tolerance absorbs that without being loose enough to
// conflate genuinely different rates (e.g. 8% vs an 8.875% combined rate).
const MATCH_TOLERANCE_PERCENTAGE_POINTS = 0.15

export interface TaxRateMatchInput {
  taxable: boolean
  taxAmount: number | null | undefined
  lineTotal: number
}

export interface TaxRateMatchResult {
  taxRateId: string | null
  /** The rate implied by taxAmount/lineTotal, for display when unmatched. Null when not computable (not taxable, or missing/zero data). */
  computedRate: number | null
}

type TaxRateRow = { id: string; rate: number }

/**
 * Match a single extracted line's implied tax rate against the tenant's
 * configured rates. Gemini only extracts a dollar tax_amount, never a
 * percentage, so the rate has to be derived first: (taxAmount / lineTotal) * 100.
 *
 * Only "purchase"/"both" type rates are considered — invoices are always
 * purchase-side; "sales" rates exist for the (separate) pricing-preview flow.
 */
export function matchTaxRate(input: TaxRateMatchInput, rates: TaxRateRow[]): TaxRateMatchResult {
  if (!input.taxable || input.taxAmount == null || input.taxAmount <= 0 || input.lineTotal <= 0) {
    return { taxRateId: null, computedRate: null }
  }

  const computedRate = (input.taxAmount / input.lineTotal) * 100

  let closest: TaxRateRow | null = null
  let closestDiff = Infinity
  for (const rate of rates) {
    const diff = Math.abs(rate.rate - computedRate)
    if (diff < closestDiff) {
      closestDiff = diff
      closest = rate
    }
  }

  const matched = closest && closestDiff <= MATCH_TOLERANCE_PERCENTAGE_POINTS ? closest : null

  return { taxRateId: matched?.id ?? null, computedRate }
}

/**
 * Batch version for invoiceProcessor.ts — fetches the tenant's purchase/both
 * tax rates once, then matches every taxable line against them.
 */
export async function matchAllTaxRates(
  db: typeof dbType,
  tenantId: string,
  items: TaxRateMatchInput[]
): Promise<TaxRateMatchResult[]> {
  const needsMatching = items.some((item) => item.taxable && item.taxAmount != null && item.taxAmount > 0)
  if (!needsMatching) {
    return items.map(() => ({ taxRateId: null, computedRate: null }))
  }

  const rates = await db.query.TaxRate.findMany({
    where: and(
      eq(TaxRate.tenant_id, tenantId),
      isNull(TaxRate.deletedAt),
      inArray(TaxRate.type, [TAX_TYPE.purchase, TAX_TYPE.both])
    ),
    columns: { id: true, rate: true },
  })

  return items.map((item) => matchTaxRate(item, rates))
}
