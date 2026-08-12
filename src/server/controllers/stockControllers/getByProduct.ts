import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { eq, and, isNull } from "drizzle-orm";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { computeStockStatus } from "../../../utils/stockStatus.ts";

export const getStockByProduct = authedProcedure
  .input(
    z.object({
      product_id: z.string(),
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

    // Previously had no tenant check and no location-access enforcement at
    // all — any authenticated user of any tenant/role could see any
    // product's stock across every location. Location-scoped roles now get
    // silently filtered to their own location, same as every other
    // location-aware list procedure.
    const locationFilter = getLocationFilter(ctx.user!, ctx.userLocationId);

    const stocks = await ctx.db.query.Stock.findMany({
      where: and(
        eq(Stock.productId, input.product_id),
        eq(Stock.tenant_id, ctx.tenantId),
        locationFilter ? eq(Stock.location_id, locationFilter) : undefined,
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
