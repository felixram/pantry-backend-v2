import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { InventoryCountEntry } from "../../../db/schema/inventoryCountEntry.ts";

export const bulkUpdateEntries = authedMutation
  .input(
    z.object({
      session_id: z.string().uuid(),
      updates: z
        .array(
          z.object({
            entry_id: z.string().uuid(),
            counted_qty: z.number().min(0),
            unit: z.string().optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    return await ctx.db.transaction(async (tx) => {
      // Verify session exists, belongs to this tenant + user's location, and is ACTIVE
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

      const entryIds = input.updates.map((u) => u.entry_id);

      // Verify all entry IDs belong to this session (prevents cross-session tampering)
      const existingEntries = await tx
        .select({ id: InventoryCountEntry.id })
        .from(InventoryCountEntry)
        .where(
          and(
            inArray(InventoryCountEntry.id, entryIds),
            eq(InventoryCountEntry.session_id, input.session_id),
          ),
        );

      if (existingEntries.length !== entryIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "One or more entry IDs do not belong to this session",
        });
      }

      const syncedAt = new Date();

      // Update each entry
      for (const update of input.updates) {
        await tx
          .update(InventoryCountEntry)
          .set({
            counted_qty: update.counted_qty,
            unit: update.unit ?? undefined,
            last_synced_at: syncedAt,
          })
          .where(eq(InventoryCountEntry.id, update.entry_id));
      }

      return { synced: input.updates.length, syncedAt };
    });
  });
