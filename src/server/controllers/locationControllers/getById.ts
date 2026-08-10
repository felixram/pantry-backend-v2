import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Location } from "../../../db/schema/location.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { eq, and, count, sum } from "drizzle-orm";

export const getLocationById = authedProcedure
  .input(
    z.object({
      id: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const location = await ctx.db.query.Location.findFirst({
      where: and(eq(Location.id, input.id), eq(Location.tenant_id, ctx.tenantId)),
    });

    if (!location) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Location not found",
      });
    }

    // Get stock count
    const [stockCount] = await ctx.db
      .select({ count: count() })
      .from(Stock)
      .where(and(eq(Stock.location_id, input.id), eq(Stock.tenant_id, ctx.tenantId)));

    // Get total quantity
    const [totalQty] = await ctx.db
      .select({ total: sum(Stock.qty) })
      .from(Stock)
      .where(and(eq(Stock.location_id, input.id), eq(Stock.tenant_id, ctx.tenantId)));

    return {
      ...location,
      stock_items_count: stockCount?.count || 0,
      total_quantity: totalQty?.total || 0,
    };
  });
