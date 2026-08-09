import { authedProcedure } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { ProductAudit } from "../../../db/schema/productAudit.ts";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { purgeExpiredDeletedProducts, PRODUCT_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredProducts.ts";

/**
 * Lists this tenant's currently-restorable (soft-deleted, within the 24h
 * window) products. Opportunistically runs the purge sweep first so this
 * view — and the app in general — stays correct even without the
 * /api/cron/product-purge job configured yet.
 */
export const getDeletedProductsProcedure = authedProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Tenant context required",
    });
  }

  await purgeExpiredDeletedProducts(ctx.db);

  const cutoff = new Date(Date.now() - PRODUCT_RESTORE_WINDOW_MS);

  const products = await ctx.db.query.Product.findMany({
    where: and(eq(Product.tenant_id, ctx.tenantId), isNotNull(Product.deletedAt), gte(Product.deletedAt, cutoff)),
    columns: { id: true, name: true, sku: true, deletedAt: true },
    orderBy: (product) => [desc(product.deletedAt)],
  });

  if (products.length === 0) {
    return { products: [] };
  }

  // Latest "deleted" audit row per product, so the trash list can show who
  // deleted it without a separate round trip to the Activity log.
  const deleteEvents = await ctx.db.query.ProductAudit.findMany({
    where: and(
      eq(ProductAudit.tenant_id, ctx.tenantId),
      inArray(
        ProductAudit.productId,
        products.map((product) => product.id)
      ),
      eq(ProductAudit.action, "deleted")
    ),
    columns: { productId: true, createdAt: true },
    with: { user: { columns: { name: true } } },
    orderBy: (auditRow) => [desc(auditRow.createdAt)],
  });

  const deletedByNameByProductId = new Map<string, string>();
  for (const event of deleteEvents) {
    if (event.productId && !deletedByNameByProductId.has(event.productId)) {
      deletedByNameByProductId.set(event.productId, event.user?.name || "Unknown User");
    }
  }

  return {
    products: products.map((product) => ({
      ...product,
      deletedByName: deletedByNameByProductId.get(product.id) ?? null,
    })),
  };
});
