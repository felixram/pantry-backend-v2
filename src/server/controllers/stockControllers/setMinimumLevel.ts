import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { eq } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";
import { toBaseUnits } from "../../../utils/unitConversion.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const setMinimumLevel = adminMutation
  .input(
    z.object({
      stock_id: z.string(),
      minimumStockLevel: z.number().nonnegative(),
      unit_name: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const stock = await ctx.db.query.Stock.findFirst({
      where: eq(Stock.id, input.stock_id),
    });

    if (!stock) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Stock record not found",
      });
    }

    if (stock.deletedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot set minimum level on archived stock. Restore it first.",
      });
    }

    // MANAGER can only set minimum levels for stock in their location
    if (ctx.user!.role === ROLES.manager && stock.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only set minimum levels for stock in their location",
      });
    }

    const { conversions, factor: conversionFactor } = await resolveUnitFactor(
      ctx.db,
      stock.productId!,
      ctx.tenantId!,
      input.unit_name,
    );

    const baseMinimum = input.unit_name
      ? toBaseUnits(input.minimumStockLevel, conversions, input.unit_name)
      : input.minimumStockLevel;

    await ctx.db
      .update(Stock)
      .set({
        minimumStockLevel: baseMinimum,
        display_unit: input.unit_name && conversionFactor !== 1 ? input.unit_name : null,
      })
      .where(eq(Stock.id, input.stock_id));

    return {
      message: "Minimum stock level updated successfully",
      stock_id: input.stock_id,
      old_minimum: stock.minimumStockLevel,
      new_minimum: baseMinimum,
    };
  });
