import { authedProcedure } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
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

  return { products };
});
