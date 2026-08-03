import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { eq } from "drizzle-orm";
import { ROLES } from "../../../types/user.ts";

export const archiveStock = adminMutation
  .input(
    z.object({
      stock_id: z.string(),
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

    // MANAGER can only archive stock in their location
    if (
      ctx.user!.role === ROLES.manager &&
      stock.location_id !== ctx.userLocationId
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only archive stock in their location",
      });
    }

    if (stock.deletedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Stock record is already archived",
      });
    }

    const [archived] = await ctx.db
      .update(Stock)
      .set({ deletedAt: new Date() })
      .where(eq(Stock.id, input.stock_id))
      .returning();

    return {
      message: "Stock record archived successfully",
      stock_id: archived!.id,
    };
  });
