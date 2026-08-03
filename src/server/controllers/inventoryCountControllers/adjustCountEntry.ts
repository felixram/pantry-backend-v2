import { z } from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountEntry } from "../../../db/schema/inventoryCountEntry.ts";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { isLocationScoped } from "../../../types/user.ts";

export const adjustCountEntry = adminMutation
  .input(z.object({
    entry_id: z.string().uuid(),
    reviewed_qty: z.number().nullable(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const entry = await ctx.db.query.InventoryCountEntry.findFirst({
      where: eq(InventoryCountEntry.id, input.entry_id),
      with: { session: true },
    });

    if (!entry) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Count entry not found" });
    }

    // Verify tenant
    if (entry.session.tenant_id !== ctx.tenantId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Count entry not found" });
    }

    // Location access check for managers
    if (isLocationScoped(ctx.user!.role) && ctx.userLocationId && entry.session.location_id !== ctx.userLocationId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this count session" });
    }

    if (entry.session.status !== INVENTORY_COUNT_STATUS.pending_review) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This session is not pending review" });
    }

    await ctx.db
      .update(InventoryCountEntry)
      .set({ reviewed_qty: input.reviewed_qty })
      .where(eq(InventoryCountEntry.id, input.entry_id));

    return { message: "Entry adjusted" };
  });
