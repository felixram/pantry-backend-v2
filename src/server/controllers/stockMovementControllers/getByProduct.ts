import z from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { Product } from "../../../db/schema/product.ts";
import { eq, and, desc } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";

export const getStockMovementsByProduct = adminProcedure
  .input(
    z.object({
      product_id: z.string(),
      limit: z.number().min(1).max(1000).default(100),
    })
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

    // MANAGER sees only movements for their location
    const whereClause =
      ctx.user!.role === ROLES.manager && ctx.userLocationId
        ? and(
            eq(StockMovement.product_id, input.product_id),
            eq(StockMovement.location_id, ctx.userLocationId)
          )
        : eq(StockMovement.product_id, input.product_id);

    const movements = await ctx.db.query.StockMovement.findMany({
      where: whereClause,
      with: {
        user: true,
        location: true,
      },
      orderBy: [desc(StockMovement.createdAt)],
      limit: input.limit,
    });

    return {
      product,
      movements,
      total: movements.length,
    };
  });
