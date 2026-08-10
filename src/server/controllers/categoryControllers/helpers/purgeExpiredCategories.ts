import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm"
import { db } from "../../../../db/index.ts"
import { Category } from "../../../../db/schema/category.ts"
import { Tenant } from "../../../../db/schema/tenant.ts"

export const CATEGORY_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000

// Unlike purgeExpiredProducts.ts / purgeExpiredSuppliers.ts, there's no
// blocking-reference scan here: the only table referencing Category.id is
// Product.category_id, and it's onDelete: "set null" — hard-deleting a
// category never fails a FK constraint, so every expired candidate purges
// unconditionally.
export async function purgeExpiredDeletedCategories(database: typeof db = db) {
  const cutoff = new Date(Date.now() - CATEGORY_RESTORE_WINDOW_MS)

  const candidates = await database
    .select({ id: Category.id })
    .from(Category)
    .innerJoin(Tenant, eq(Category.tenant_id, Tenant.id))
    .where(
      and(isNotNull(Category.deletedAt), lt(Category.deletedAt, cutoff), eq(Tenant.is_demo, false), isNull(Tenant.deletedAt))
    )

  if (candidates.length === 0) return { checked: 0, purged: 0 }

  const candidateIds = candidates.map((c) => c.id)
  await database.delete(Category).where(inArray(Category.id, candidateIds))

  return { checked: candidates.length, purged: candidateIds.length }
}
