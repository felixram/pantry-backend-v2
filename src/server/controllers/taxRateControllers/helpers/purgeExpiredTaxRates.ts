import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm"
import { db } from "../../../../db/index.ts"
import { TaxRate } from "../../../../db/schema/taxRate.ts"
import { Tenant } from "../../../../db/schema/tenant.ts"
import { Product } from "../../../../db/schema/product.ts"
import { Category } from "../../../../db/schema/category.ts"
import { Location } from "../../../../db/schema/location.ts"

export const TAX_RATE_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000

export async function purgeExpiredDeletedTaxRates(database: typeof db = db) {
  const cutoff = new Date(Date.now() - TAX_RATE_RESTORE_WINDOW_MS)

  const candidates = await database
    .select({ id: TaxRate.id })
    .from(TaxRate)
    .innerJoin(Tenant, eq(TaxRate.tenant_id, Tenant.id))
    .where(
      and(isNotNull(TaxRate.deletedAt), lt(TaxRate.deletedAt, cutoff), eq(Tenant.is_demo, false), isNull(Tenant.deletedAt))
    )

  if (candidates.length === 0) return { checked: 0, purged: 0 }

  const candidateIds = candidates.map((c) => c.id)

  // None of these four FKs are onDelete: "set null" (unlike
  // Product.category_id), so a rate still referenced by any of them would
  // fail the hard delete below — filter them out first instead of letting
  // the constraint error surface.
  const [products, categories, locations] = await Promise.all([
    database.select({ taxRateId: Product.tax_rate_id }).from(Product).where(inArray(Product.tax_rate_id, candidateIds)),
    database.select({ taxRateId: Category.tax_rate_id }).from(Category).where(inArray(Category.tax_rate_id, candidateIds)),
    database
      .select({ purchaseTaxRateId: Location.default_purchase_tax_rate_id, salesTaxRateId: Location.default_sales_tax_rate_id })
      .from(Location)
      .where(
        or(
          inArray(Location.default_purchase_tax_rate_id, candidateIds),
          inArray(Location.default_sales_tax_rate_id, candidateIds)
        )
      ),
  ])

  const referencedIds = new Set<string>()
  for (const row of products) if (row.taxRateId) referencedIds.add(row.taxRateId)
  for (const row of categories) if (row.taxRateId) referencedIds.add(row.taxRateId)
  for (const row of locations) {
    if (row.purchaseTaxRateId) referencedIds.add(row.purchaseTaxRateId)
    if (row.salesTaxRateId) referencedIds.add(row.salesTaxRateId)
  }

  const purgeableIds = candidateIds.filter((id) => !referencedIds.has(id))
  if (purgeableIds.length > 0) {
    await database.delete(TaxRate).where(inArray(TaxRate.id, purgeableIds))
  }

  return { checked: candidates.length, purged: purgeableIds.length }
}
