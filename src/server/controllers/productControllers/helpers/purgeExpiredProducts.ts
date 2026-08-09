import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "../../../../db/index.ts";
import { Product } from "../../../../db/schema/product.ts";
import { Tenant } from "../../../../db/schema/tenant.ts";
import { StockMovement } from "../../../../db/schema/stockMovement.ts";
import { PurchaseOrderItem } from "../../../../db/schema/purchaseOrderItem.ts";
import { ProductAlias } from "../../../../db/schema/productAlias.ts";
import { InvoiceItem } from "../../../../db/schema/invoiceItem.ts";

/** Single source of truth for the soft-delete recovery window. */
export const PRODUCT_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Finds products soft-deleted longer than PRODUCT_RESTORE_WINDOW_MS ago and
 * hard-deletes the ones that are safe to hard-delete.
 *
 * "Safe" means no row in StockMovement, PurchaseOrderItem, ProductAlias, or
 * InvoiceItem references it — those all have ON DELETE NO ACTION in the real
 * DB (confirmed against migration SQL, not just the schema file), so a raw
 * DELETE would throw a FK-violation for any product with real transaction
 * history. Rather than cascade those away (which would silently destroy
 * purchase-order/stock-movement audit history), a product with any such
 * reference is left soft-deleted permanently — it's already unrestorable and
 * invisible everywhere once past the window (see restore.ts/getDeleted.ts),
 * so from the app's perspective it's indistinguishable from "gone." Mirrors
 * the same check-then-hard-delete shape as userControllers/hardDelete.ts.
 *
 * Called both opportunistically (getDeleted.ts, so the feature is correct
 * without depending on the cron being configured) and from the
 * /api/cron/product-purge endpoint in index.ts.
 */
export async function purgeExpiredDeletedProducts(database: typeof db = db) {
  const cutoff = new Date(Date.now() - PRODUCT_RESTORE_WINDOW_MS);

  const candidates = await database
    .select({ id: Product.id })
    .from(Product)
    .innerJoin(Tenant, eq(Product.tenant_id, Tenant.id))
    .where(
      and(
        isNotNull(Product.deletedAt),
        lt(Product.deletedAt, cutoff),
        eq(Tenant.is_demo, false),
        isNull(Tenant.deletedAt)
      )
    );

  if (candidates.length === 0) {
    return { checked: 0, purged: 0 };
  }

  const candidateIds = candidates.map((candidate) => candidate.id);

  // One batched query per referencing table instead of 4 queries per
  // candidate — O(1) round trips regardless of how many products are up
  // for purge, rather than O(4n).
  const [stockMovements, poItems, aliases, invoiceItems] = await Promise.all([
    database
      .select({ productId: StockMovement.product_id })
      .from(StockMovement)
      .where(inArray(StockMovement.product_id, candidateIds)),
    database
      .select({ productId: PurchaseOrderItem.product_id })
      .from(PurchaseOrderItem)
      .where(inArray(PurchaseOrderItem.product_id, candidateIds)),
    database
      .select({ productId: ProductAlias.product_id })
      .from(ProductAlias)
      .where(inArray(ProductAlias.product_id, candidateIds)),
    database
      .select({ productId: InvoiceItem.matched_product_id, confirmedProductId: InvoiceItem.confirmed_product_id })
      .from(InvoiceItem)
      .where(
        or(inArray(InvoiceItem.matched_product_id, candidateIds), inArray(InvoiceItem.confirmed_product_id, candidateIds))
      ),
  ]);

  const referencedIds = new Set<string>();
  for (const row of stockMovements) if (row.productId) referencedIds.add(row.productId);
  for (const row of poItems) if (row.productId) referencedIds.add(row.productId);
  for (const row of aliases) if (row.productId) referencedIds.add(row.productId);
  for (const row of invoiceItems) {
    if (row.productId) referencedIds.add(row.productId);
    if (row.confirmedProductId) referencedIds.add(row.confirmedProductId);
  }

  const purgeableIds = candidateIds.filter((id) => !referencedIds.has(id));

  if (purgeableIds.length > 0) {
    await database.delete(Product).where(inArray(Product.id, purgeableIds));
  }

  return { checked: candidates.length, purged: purgeableIds.length };
}
