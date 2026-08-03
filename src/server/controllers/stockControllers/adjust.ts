import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { toBaseUnits } from "../../../utils/unitConversion.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const adjustStock = authedMutation
  .input(
    z.object({
      stock_id: z.string(),
      change_qty: z.number(),
      reason: z.string().min(3, "Reason must be at least 3 characters"),
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

    return await ctx.db.transaction(async (tx) => {
      // Get current stock
      const stock = await tx.query.Stock.findFirst({
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
          message: "Cannot adjust archived stock. Restore it first.",
        });
      }

      // Validate user has access to this stock's location
      validateLocationAccess(ctx.user!, ctx.userLocationId, stock.location_id!);

      const { conversions, factor: conversionFactor } = await resolveUnitFactor(
        tx,
        stock.productId!,
        ctx.tenantId!,
        input.unit_name,
      );

      const baseChangeQty = input.unit_name
        ? toBaseUnits(input.change_qty, conversions, input.unit_name)
        : input.change_qty;

      // Validate won't go negative
      const newQty = stock.qty + baseChangeQty;
      if (newQty < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient stock. Available: ${stock.qty}, requested change: ${baseChangeQty}`,
        });
      }

      // Update stock
      await tx.update(Stock).set({ qty: newQty }).where(eq(Stock.id, input.stock_id));

      // Log movement with unit info
      const sign = input.change_qty >= 0 ? "+" : "";
      const reason = input.unit_name && conversionFactor !== 1
        ? `${input.reason} (${sign}${input.change_qty} ${input.unit_name} = ${sign}${baseChangeQty} base units)`
        : input.reason;

      await tx.insert(StockMovement).values({
        product_id: stock.productId!,
        location_id: stock.location_id!,
        change_qty: baseChangeQty,
        reason,
        user_id: ctx.user!.id,
        tenant_id: ctx.tenantId!,
      });

      return {
        message: "Stock adjusted successfully",
        old_qty: stock.qty,
        new_qty: newQty,
        change: baseChangeQty,
      };
    });
  });
