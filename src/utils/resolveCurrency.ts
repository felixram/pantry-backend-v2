import { eq } from "drizzle-orm"
import { db } from "../db/index.ts"
import { Tenant } from "../db/schema/tenant.ts"
import { Supplier } from "../db/schema/supplier.ts"
import { normalizeCurrency } from "../types/currency.ts"

/** The tenant's configured default currency (ISO 4217), or "USD". */
export async function getTenantDefaultCurrency(tenantId: string): Promise<string> {
  const row = await db.query.Tenant.findFirst({
    where: eq(Tenant.id, tenantId),
    columns: { default_currency: true },
  })
  return row?.default_currency || "USD"
}

/**
 * Resolve the currency for an invoice: the document's own currency wins if
 * it normalizes to a supported code, then the matched supplier's currency,
 * then the tenant default. Always returns a concrete ISO code.
 */
export async function resolveInvoiceCurrency(
  tenantId: string,
  rawExtractedCurrency: string | null | undefined,
  supplierId: string | null | undefined,
): Promise<string> {
  const fromDocument = normalizeCurrency(rawExtractedCurrency)
  if (fromDocument) return fromDocument

  if (supplierId) {
    const supplier = await db.query.Supplier.findFirst({
      where: eq(Supplier.id, supplierId),
      columns: { currency: true },
    })
    if (supplier?.currency) return supplier.currency
  }

  return getTenantDefaultCurrency(tenantId)
}
