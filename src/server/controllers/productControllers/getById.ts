import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Product } from "../../../db/schema/product.ts";
import { eq, and } from "drizzle-orm";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { allUnitPrices, findBaseUnit } from "../../../utils/unitConversion.ts";

export const getProductById = authedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const product = await ctx.db.query.Product.findFirst({
      where: and(eq(Product.id, input.id), eq(Product.tenant_id, ctx.tenantId!)),
      with: {
        version: true,
        supplier: true,
        category: true,
        unitConversions: true,
      },
    });

    if (!product) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Product not found",
      });
    }

    // Calculate prices for all units
    const conversions = product.unitConversions ?? [];
    const version = product.version;

    const calculatedPrices =
      version && conversions.length > 0
        ? {
            cost: allUnitPrices(version.costPrice, version.costPriceUnit ?? null, conversions),
            selling:
              version.sellingPrice !== null && version.sellingPrice !== undefined
                ? allUnitPrices(version.sellingPrice, version.sellingPriceUnit ?? null, conversions)
                : null,
            baseUnitName: findBaseUnit(conversions)?.unit_name ?? null,
          }
        : null;

    return {
      ...product,
      calculatedPrices,
    };
  });
