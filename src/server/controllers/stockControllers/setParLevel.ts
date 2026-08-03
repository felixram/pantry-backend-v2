import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { eq } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";
import { toBaseUnits } from "../../../utils/unitConversion.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const setParLevel = adminMutation
  .input(
    z.object({
      stock_id: z.string(),
      parLevel: z.number().nonnegative(),
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
        message: "Cannot set par level on archived stock. Restore it first.",
      });
    }

    // MANAGER can only set par levels for stock in their location
    if (ctx.user!.role === ROLES.manager && stock.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only set par levels for stock in their location",
      });
    }

    const { conversions } = await resolveUnitFactor(
      ctx.db,
      stock.productId!,
      ctx.tenantId!,
      input.unit_name,
    );

    const baseParLevel = input.unit_name
      ? toBaseUnits(input.parLevel, conversions, input.unit_name)
      : input.parLevel;

    // Validate par level >= minimum stock level when both are set
    if (stock.minimumStockLevel !== null && baseParLevel < stock.minimumStockLevel) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Par level must be greater than or equal to the minimum stock level",
      });
    }

    await ctx.db
      .update(Stock)
      .set({ parLevel: baseParLevel })
      .where(eq(Stock.id, input.stock_id));

    return {
      message: "Par level updated successfully",
      stock_id: input.stock_id,
      old_parLevel: stock.parLevel,
      new_parLevel: baseParLevel,
    };
  });
