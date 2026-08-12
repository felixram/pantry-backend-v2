import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { and, eq } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";

export const restoreStock = adminMutation
  .input(
    z.object({
      stock_id: z.string(),
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

    // MANAGER can only restore stock in their location
    if (
      ctx.user!.role === ROLES.manager &&
      stock.location_id !== ctx.userLocationId
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only restore stock in their location",
      });
    }

    if (!stock.deletedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Stock record is not archived",
      });
    }

    const [restored] = await ctx.db
      .update(Stock)
      .set({ deletedAt: null })
      .where(and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId)))
      .returning();

    return {
      message: "Stock record restored successfully",
      stock_id: restored!.id,
    };
  });
