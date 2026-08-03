import z from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Product } from "../../../db/schema/product.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { eq, desc } from "drizzle-orm";

export const getProductPriceHistory = adminProcedure
  .input(
    z.object({
      product_id: z.string(),
      limit: z.number().min(1).max(100).default(10),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Validate product exists
    const product = await ctx.db.query.Product.findFirst({
      where: eq(Product.id, input.product_id),
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
    });

    return {
      product,
      history: priceHistory,
      total_versions: priceHistory.length,
    };
  });
