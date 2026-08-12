import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { and, eq } from "drizzle-orm";
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
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const stock = await ctx.db.query.Stock.findFirst({
      where: and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId)),
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

    // Same par >= minimum rule setParLevel enforces from the other
    // direction — without this, setMinimumLevel could push the minimum
    // above an already-set par level with no check.
    if (stock.parLevel !== null && baseMinimum > stock.parLevel) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Minimum stock level cannot be greater than the par level",
      });
    }

    await ctx.db
      .update(Stock)
      .set({
        minimumStockLevel: baseMinimum,
        display_unit: input.unit_name && conversionFactor !== 1 ? input.unit_name : null,
      })
      .where(and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId)));

    return {
      message: "Minimum stock level updated successfully",
      stock_id: input.stock_id,
      old_minimum: stock.minimumStockLevel,
      new_minimum: baseMinimum,
    };
  });
