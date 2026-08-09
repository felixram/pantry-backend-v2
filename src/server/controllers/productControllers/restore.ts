import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { ProductAudit } from "../../../db/schema/productAudit.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PRODUCT_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredProducts.ts";

export const restoreProductProcedure = adminMutation
  .input(
    z.object({
      productId: z.uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const product = await ctx.db.query.Product.findFirst({
      where: and(eq(Product.id, input.productId), eq(Product.tenant_id, ctx.tenantId), isNotNull(Product.deletedAt)),
      columns: { id: true, name: true, sku: true, deletedAt: true },
    });

    if (!product) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Deleted product not found.",
      });
    }

    const deletedAt = product.deletedAt as Date;
    if (Date.now() - deletedAt.getTime() > PRODUCT_RESTORE_WINDOW_MS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This product's recovery window has expired and it can no longer be restored.",
      });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(Product).set({ deletedAt: null }).where(eq(Product.id, input.productId));
      await tx.insert(ProductAudit).values({
        productId: input.productId,
        productName: product.name,
        productSku: product.sku,
        tenant_id: ctx.tenantId!,
        action: "restored",
        userId: ctx.user!.id,
      });
    });

    return { message: "Product restored successfully." };
  });
