import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";

export const completeSession = authedMutation
  .input(z.object({ session_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    return await ctx.db.transaction(async (tx) => {
      // Verify session exists, belongs to this tenant, and is ACTIVE
      const session = await tx.query.InventoryCountSession.findFirst({
        where: and(
          eq(InventoryCountSession.id, input.session_id),
          eq(InventoryCountSession.tenant_id, ctx.tenantId!),
        ),
      });

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Count session not found" });
      }

      if (ctx.userLocationId && session.location_id !== ctx.userLocationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this count session",
        });
      }

      if (session.status !== INVENTORY_COUNT_STATUS.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This count session is already completed",
        });
      }

      // Move to PENDING_REVIEW instead of directly completing
      await tx
        .update(InventoryCountSession)
        .set({
          status: INVENTORY_COUNT_STATUS.pending_review,
          submitted_at: new Date(),
          completed_by: ctx.user!.id,
        })
        .where(eq(InventoryCountSession.id, input.session_id));

      return {
        message: "Inventory count submitted for review",
        hasLowStockItems: false,
        weekIdentifier: session.week_identifier,
        location_id: session.location_id,
        session_id: input.session_id,
      };
    });
  });
