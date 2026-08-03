import { z } from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { isLocationScoped } from "../../../types/user.ts";

export const getCountsForReview = adminProcedure
  .input(z.object({ location_id: z.string().uuid().optional() }).optional())
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const conditions = [
      eq(InventoryCountSession.tenant_id, ctx.tenantId),
      eq(InventoryCountSession.status, INVENTORY_COUNT_STATUS.pending_review),
    ];

    // Location-scoped users (managers) only see their location
    if (isLocationScoped(ctx.user!.role) && ctx.userLocationId) {
      conditions.push(eq(InventoryCountSession.location_id, ctx.userLocationId));
    } else if (input?.location_id) {
      conditions.push(eq(InventoryCountSession.location_id, input.location_id));
    }

    const sessions = await ctx.db.query.InventoryCountSession.findMany({
      where: and(...conditions),
      with: {
        location: { columns: { id: true, name: true } },
        completedByUser: { columns: { id: true, name: true, last_name: true } },
        entries: { columns: { id: true } },
      },
      orderBy: (s, { desc }) => [desc(s.submitted_at)],
    });

    return sessions.map((s) => ({
      id: s.id,
      week_identifier: s.week_identifier,
      location_name: s.location?.name ?? "Unknown",
      location_id: s.location_id,
      submitted_by_name: s.completedByUser
        ? `${s.completedByUser.name} ${s.completedByUser.last_name}`
        : "Unknown",
      submitted_at: s.submitted_at,
      entry_count: s.entries.length,
    }));
  });
