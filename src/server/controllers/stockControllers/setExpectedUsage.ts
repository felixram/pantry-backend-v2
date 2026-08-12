import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { and, eq } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";
import { toBaseUnits } from "../../../utils/unitConversion.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const setExpectedUsage = adminMutation
  .input(
    z.object({
      stock_id: z.string(),
      expectedUsage: z.number().nonnegative(),
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
        message: "Cannot set expected usage on archived stock. Restore it first.",
      });
    }

    // MANAGER can only set expected usage for stock in their location
    if (ctx.user!.role === ROLES.manager && stock.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only set expected usage for stock in their location",
      });
    }

    const { conversions } = await resolveUnitFactor(
      ctx.db,
      stock.productId!,
      ctx.tenantId!,
      input.unit_name,
    );

    const baseExpectedUsage = input.unit_name
      ? toBaseUnits(input.expectedUsage, conversions, input.unit_name)
      : input.expectedUsage;

    await ctx.db
      .update(Stock)
      .set({ expectedUsage: baseExpectedUsage })
      .where(and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId)));

    return {
      message: "Expected usage updated successfully",
      stock_id: input.stock_id,
      old_expectedUsage: stock.expectedUsage,
      new_expectedUsage: baseExpectedUsage,
    };
  });
