import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
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

  let purged = 0;

  for (const candidate of candidates) {
    const [stockMovement] = await database
      .select({ id: StockMovement.id })
      .from(StockMovement)
      .where(eq(StockMovement.product_id, candidate.id))
      .limit(1);
    const [poItem] = await database
      .select({ id: PurchaseOrderItem.id })
      .from(PurchaseOrderItem)
      .where(eq(PurchaseOrderItem.product_id, candidate.id))
      .limit(1);
    const [alias] = await database
      .select({ id: ProductAlias.id })
      .from(ProductAlias)
      .where(eq(ProductAlias.product_id, candidate.id))
      .limit(1);
    const [invoiceItem] = await database
      .select({ id: InvoiceItem.id })
      .from(InvoiceItem)
      .where(or(eq(InvoiceItem.matched_product_id, candidate.id), eq(InvoiceItem.confirmed_product_id, candidate.id)))
      .limit(1);

    const hasReferences = Boolean(stockMovement || poItem || alias || invoiceItem);
    if (!hasReferences) {
      await database.delete(Product).where(eq(Product.id, candidate.id));
      purged++;
    }
  }

  return { checked: candidates.length, purged };
}
