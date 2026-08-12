import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { and, eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { computeStockStatus } from "../../../utils/stockStatus.ts";

export const getStockById = authedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const stock = await ctx.db.query.Stock.findFirst({
      where: and(eq(Stock.id, input.id), eq(Stock.tenant_id, ctx.tenantId)),
      with: {
        product: {
          with: {
            unitConversions: true,
          },
        },
        location: true,
      },
    });

    if (!stock) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Stock record not found",
      });
    }

    // Validate location access for location-scoped users
    if (stock.location_id) {
      validateLocationAccess(ctx.user!, ctx.userLocationId, stock.location_id);
    }

    return {
      ...stock,
      status: computeStockStatus(stock),
    };
  });
