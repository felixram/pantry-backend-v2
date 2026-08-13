import { z } from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { isLocationScoped } from "../../../types/user.ts";
import { applyCountToStock } from "./helpers/applyCountToStock.ts";

export const approveCount = adminMutation
  .input(z.object({ session_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    return await ctx.db.transaction(async (tx) => {
      const session = await tx.query.InventoryCountSession.findFirst({
        where: and(
          eq(InventoryCountSession.id, input.session_id),
          eq(InventoryCountSession.tenant_id, ctx.tenantId!),
        ),
      });

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Count session not found" });
      }

      // Location access check for managers
      if (isLocationScoped(ctx.user!.role) && ctx.userLocationId && session.location_id !== ctx.userLocationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this count session" });
      }

      if (session.status !== INVENTORY_COUNT_STATUS.pending_review) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This session is not pending review" });
      }

      const { adjustedItems, skippedItems, hasLowStockItems } = await applyCountToStock(tx, {
        sessionId: input.session_id,
        locationId: session.location_id!,
        weekIdentifier: session.week_identifier,
        userId: ctx.user!.id,
        tenantId: ctx.tenantId!,
      });

      // Mark session as completed
      await tx
        .update(InventoryCountSession)
        .set({
          status: INVENTORY_COUNT_STATUS.completed,
          completed_at: new Date(),
          completed_by: session.completed_by, // keep original submitter
          reviewed_by: ctx.user!.id,
        })
        .where(eq(InventoryCountSession.id, input.session_id));

      return {
        message: "Inventory count approved and stock updated",
        adjustedItems,
        skippedItems,
        weekIdentifier: session.week_identifier,
        hasLowStockItems,
        location_id: session.location_id,
        session_id: input.session_id,
      };
    });
  });
