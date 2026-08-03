import { z } from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { getISOWeekIdentifier } from "../../../utils/dateUtils.ts";
import { ROLES } from "../../../types/user.ts";

export const getActiveSession = authedProcedure
  .input(z.object({ location_id: z.string().uuid().optional() }))
  .query(async ({ ctx, input }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
  }

  // Resolve effective location
  let effectiveLocationId: string | null;

  if (ctx.user!.role === ROLES.admin) {
    effectiveLocationId = input.location_id ?? null;
  } else {
    effectiveLocationId = ctx.userLocationId;
  }

  if (!effectiveLocationId) return null;

  const weekId = getISOWeekIdentifier(new Date());

  // Look for any session this week (ACTIVE or COMPLETED)
  const session = await ctx.db.query.InventoryCountSession.findFirst({
    where: and(
      eq(InventoryCountSession.tenant_id, ctx.tenantId),
      eq(InventoryCountSession.location_id, effectiveLocationId),
      eq(InventoryCountSession.week_identifier, weekId),
    ),
    with: {
      entries: {
        with: {
          product: {
            columns: { id: true, name: true, sku: true, unit: true, defaultUnit: true },
            with: {
              category: {
                columns: { id: true, name: true },
              },
              unitConversions: {
                columns: { unit_name: true, conversion_factor: true, is_base_unit: true },
              },
            },
          },
        },
      },
    },
  });

  if (!session) return null;

  // If completed or pending review, return minimal info so the client can show the "already done" state
  if (session.status === INVENTORY_COUNT_STATUS.completed || session.status === INVENTORY_COUNT_STATUS.pending_review) {
    return {
      session,
      entries: session.entries,
      completedThisWeek: true,
    };
  }

  return { session, entries: session.entries, completedThisWeek: false };
});
