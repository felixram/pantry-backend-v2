import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { InventoryCountEntry } from "../../../db/schema/inventoryCountEntry.ts";
import { hasElevatedRole } from "../../../types/user.ts";
import { applyCountToStock } from "./helpers/applyCountToStock.ts";

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

      // Server-side backstop for the client's own gating: a session can't
      // complete while any entry is still explicitly flagged "not done yet"
      // (counted some storage areas, more to come) — distinct from an item
      // never touched at all, which stays an accepted skip as always.
      const [partial] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(InventoryCountEntry)
        .where(
          and(
            eq(InventoryCountEntry.session_id, input.session_id),
            eq(InventoryCountEntry.is_partial, true),
          ),
        );
      if (partial && partial.count > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${partial.count} item${partial.count === 1 ? "" : "s"} ${partial.count === 1 ? "is" : "are"} still marked as partially counted. Finish counting or mark ${partial.count === 1 ? "it" : "them"} done before completing.`,
        });
      }

      // Elevated users (MANAGER/ADMIN) counting their own location have no
      // one further up the chain who needs to sign off — skip PENDING_REVIEW
      // entirely and apply stock directly, the same effect approveCount.ts
      // produces for a regular USER's submission once reviewed.
      if (hasElevatedRole(ctx.user!.role)) {
        const { adjustedItems, skippedItems, hasLowStockItems } = await applyCountToStock(tx, {
          sessionId: input.session_id,
          locationId: session.location_id!,
          weekIdentifier: session.week_identifier,
          userId: ctx.user!.id,
          tenantId: ctx.tenantId!,
        });

        await tx
          .update(InventoryCountSession)
          .set({
            status: INVENTORY_COUNT_STATUS.completed,
            submitted_at: new Date(),
            completed_at: new Date(),
            completed_by: ctx.user!.id,
            // No separate reviewer — the completer's elevated role stands in
            // for review. Setting this (rather than leaving it null) makes
            // "who signed off" unambiguous instead of looking like a gap.
            reviewed_by: ctx.user!.id,
          })
          .where(eq(InventoryCountSession.id, input.session_id));

        return {
          message: "Inventory count completed",
          status: INVENTORY_COUNT_STATUS.completed,
          adjustedItems,
          skippedItems,
          hasLowStockItems,
          weekIdentifier: session.week_identifier,
          location_id: session.location_id,
          session_id: input.session_id,
        };
      }

      // Regular USER: move to PENDING_REVIEW for a manager/admin to check.
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
        status: INVENTORY_COUNT_STATUS.pending_review,
        hasLowStockItems: false,
        weekIdentifier: session.week_identifier,
        location_id: session.location_id,
        session_id: input.session_id,
      };
    });
  });
