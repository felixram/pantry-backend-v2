import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { eq, and, isNull } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { computeStockStatus } from "../../../utils/stockStatus.ts";

export const getStockByLocation = authedProcedure
  .input(
    z.object({
      location_id: z.string(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Validate location access for location-scoped users
    validateLocationAccess(ctx.user!, ctx.userLocationId, input.location_id);

    const stocks = await ctx.db.query.Stock.findMany({
      where: and(
        eq(Stock.location_id, input.location_id),
        eq(Stock.tenant_id, ctx.tenantId),
        isNull(Stock.deletedAt)
      ),
      with: {
        location: true,
        product: true,
      },
      limit: input.limit,
      offset: input.offset,
    });

    return {
      stocks: stocks.map((stock) => ({
        ...stock,
        status: computeStockStatus(stock),
      })),
      total: stocks.length,
    };
  });
