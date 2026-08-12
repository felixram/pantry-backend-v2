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
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Validate product exists
    const product = await ctx.db.query.Product.findFirst({
      where: and(eq(Product.id, input.product_id), eq(Product.tenant_id, ctx.tenantId)),
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
            eq(StockMovement.tenant_id, ctx.tenantId),
            eq(StockMovement.location_id, ctx.userLocationId)
          )
        : and(eq(StockMovement.product_id, input.product_id), eq(StockMovement.tenant_id, ctx.tenantId));

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
