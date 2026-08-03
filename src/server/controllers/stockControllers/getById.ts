import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";

export const getStockById = authedProcedure
  .input(
    z.object({
      id: z.string(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const stock = await ctx.db.query.Stock.findFirst({
      where: eq(Stock.id, input.id),
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

    // Calculate status
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
  });
