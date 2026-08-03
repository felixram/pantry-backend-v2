import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { eq, and, isNull } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";

export const getStockByLocation = authedProcedure
  .input(
    z.object({
      location_id: z.string(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Validate location access for location-scoped users
    validateLocationAccess(ctx.user!, ctx.userLocationId, input.location_id);

    const stocks = await ctx.db.query.Stock.findMany({
      where: and(eq(Stock.location_id, input.location_id), isNull(Stock.deletedAt)),
      with: {
        location: true,
        product: true,
      },
      limit: input.limit,
      offset: input.offset,
    });

    return {
      stocks: stocks.map((stock) => {
        let status: "OK" | "LOW" | "OUT_OF_STOCK";
        if (stock.qty === 0) {
          status = "OUT_OF_STOCK";
        } else if (
          stock.minimumStockLevel &&
          stock.qty <= stock.minimumStockLevel
        ) {
          status = "LOW";
        } else {
          status = "OK";
        }
        return {
          ...stock,
          status,
        };
      }),
      total: stocks.length,
    };
  });
