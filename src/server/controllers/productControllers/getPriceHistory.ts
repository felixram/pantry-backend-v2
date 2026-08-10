import z from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Product } from "../../../db/schema/product.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { and, eq, desc } from "drizzle-orm";

export const getProductPriceHistory = adminProcedure
  .input(
    z.object({
      product_id: z.string(),
      limit: z.number().min(1).max(100).default(10),
      offset: z.number().min(0).default(0),
    }),
  )
  .query(async ({ ctx, input }) => {
    // Validate product exists — tenant-scoped, otherwise any admin/manager
    // could pull another tenant's price history by product id alone.
    const product = await ctx.db.query.Product.findFirst({
      where: and(eq(Product.id, input.product_id), eq(Product.tenant_id, ctx.tenantId!)),
    });

    if (!product) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Product not found",
      });
    }

    // Get price history
    const priceHistory = await ctx.db.query.ProductVersion.findMany({
      where: eq(ProductVersion.productId, input.product_id),
      orderBy: [desc(ProductVersion.versionNumber)],
      limit: input.limit,
      offset: input.offset,
    });

    return {
      product,
      history: priceHistory,
      total_versions: priceHistory.length,
    };
  });
