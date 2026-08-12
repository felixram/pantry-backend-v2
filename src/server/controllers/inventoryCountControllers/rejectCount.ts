import { z } from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { isLocationScoped } from "../../../types/user.ts";

export const rejectCount = adminMutation
  .input(z.object({ session_id: z.string().uuid(), reason: z.string().min(3, "Reason must be at least 3 characters") }))
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

      // Reopen for recount — reset to ACTIVE rather than a terminal status.
      // Entries (counted_qty/reviewed_qty) are left untouched: the counter
      // sees their prior taps still there and only needs to correct what's
      // wrong, not start over.
      await tx
        .update(InventoryCountSession)
        .set({
          status: INVENTORY_COUNT_STATUS.active,
          submitted_at: null,
          completed_by: null,
          rejected_at: new Date(),
          rejected_by: ctx.user!.id,
          rejection_reason: input.reason,
        })
        .where(eq(InventoryCountSession.id, input.session_id));

      return {
        message: "Inventory count sent back for recount",
        session_id: input.session_id,
        weekIdentifier: session.week_identifier,
        location_id: session.location_id,
      };
    });
  });
