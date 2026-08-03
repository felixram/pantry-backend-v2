import z from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Product } from "../../../db/schema/product.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { eq, sql, desc } from "drizzle-orm";

export const getProductCostAnalysis = adminProcedure
  .input(
    z.object({
      product_id: z.string(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Validate product exists
    const product = await ctx.db.query.Product.findFirst({
      where: eq(Product.id, input.product_id),
      with: {
        version: true,
      },
    });

    if (!product) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Product not found",
      });
    }

    // Get all versions for analysis (limit to prevent memory exhaustion)
    const VERSION_LIMIT = 500;
    const allVersions = await ctx.db.query.ProductVersion.findMany({
      where: eq(ProductVersion.productId, input.product_id),
      orderBy: [desc(ProductVersion.versionNumber)],
      limit: VERSION_LIMIT,
    });

    if (allVersions.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No pricing history found for this product",
      });
    }

    // Warn if we hit the limit (indicates very large version history)
    if (allVersions.length === VERSION_LIMIT) {
      console.warn(
        `Product ${input.product_id} has ${VERSION_LIMIT}+ versions, cost analysis may be incomplete`
      );
    }

    // Calculate average cost
    const [avgResult] = await ctx.db
      .select({
        avg: sql<number>`AVG(${ProductVersion.costPrice})`,
        min: sql<number>`MIN(${ProductVersion.costPrice})`,
        max: sql<number>`MAX(${ProductVersion.costPrice})`,
      })
      .from(ProductVersion)
      .where(eq(ProductVersion.productId, input.product_id));

    // Get last purchase cost from purchase orders
    const lastPurchase = await ctx.db.query.PurchaseOrderItem.findFirst({
      where: eq(PurchaseOrderItem.product_id, input.product_id),
      orderBy: [desc(PurchaseOrderItem.createdAt)],
    });

    // Determine price trend (last 3 versions)
    const recentVersions = allVersions.slice(0, 3);
    let trend: "increasing" | "decreasing" | "stable" = "stable";

    if (recentVersions.length >= 2) {
      const latestPrice = recentVersions[0]?.costPrice || 0;
      const previousPrice = recentVersions[1]?.costPrice || 0;

      if (latestPrice > previousPrice) {
        trend = "increasing";
      } else if (latestPrice < previousPrice) {
        trend = "decreasing";
      }
    }

    // Calculate variance (coefficient of variation)
    const avgCost = avgResult?.avg || 0;
    let variance = 0;
    if (avgCost > 0 && allVersions.length > 1) {
      const sumSquaredDiff = allVersions.reduce((sum, v) => {
        const diff = (v.costPrice || 0) - avgCost;
        return sum + diff * diff;
      }, 0);
      const stdDev = Math.sqrt(sumSquaredDiff / allVersions.length);
      variance = (stdDev / avgCost) * 100; // Coefficient of variation as percentage
    }

    return {
      product: {
        name: product.name,
        versionCount: allVersions.length,
      },
      averageCostPrice: avgResult?.avg || 0,
      minCostPrice: avgResult?.min || 0,
      maxCostPrice: avgResult?.max || 0,
      lastPurchasePrice: lastPurchase?.unit_price || null,
      priceTrend: trend,
      variance: variance,
    };
  });
