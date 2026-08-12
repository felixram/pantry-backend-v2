import z from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { Location } from "../../../db/schema/location.ts";
import { and, eq, desc } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";

export const getStockMovementsByLocation = adminProcedure
  .input(
    z.object({
      location_id: z.string(),
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

    // MANAGER can only view movements for their location
    if (ctx.user!.role === ROLES.manager && input.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only view stock movements for your location",
      });
    }

    // Validate location exists
    const location = await ctx.db.query.Location.findFirst({
      where: and(eq(Location.id, input.location_id), eq(Location.tenant_id, ctx.tenantId)),
    });

    if (!location) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Location not found",
      });
    }

    const movements = await ctx.db.query.StockMovement.findMany({
      where: and(eq(StockMovement.location_id, input.location_id), eq(StockMovement.tenant_id, ctx.tenantId)),
      with: {
        user: true,
        products: true,
      },
      orderBy: [desc(StockMovement.createdAt)],
      limit: input.limit,
    });

    return {
      location,
      movements,
      total: movements.length,
    };
  });
