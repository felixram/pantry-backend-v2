import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Location } from "../../../db/schema/location.ts";
import { LocationAudit } from "../../../db/schema/locationAudit.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ROLES } from "../../../types/user.ts";

// No time-window restriction, unlike restoreProductProcedure/restoreSupplierProcedure/
// restoreCategoryProcedure — locations have no purge cron (see purgeExpiredCategories.ts's
// counterparts), so a soft-deleted location stays restorable indefinitely.
export const restoreLocationProcedure = adminMutation
  .input(z.object({ id: z.uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can restore locations",
      });
    }

    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const location = await ctx.db.query.Location.findFirst({
      where: and(eq(Location.id, input.id), eq(Location.tenant_id, ctx.tenantId), isNotNull(Location.deletedAt)),
      columns: { id: true, name: true },
    });

    if (!location) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Deleted location not found." });
    }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(Location)
        .set({ active: true, deletedAt: null, deletedBy: null })
        .where(and(eq(Location.id, input.id), eq(Location.tenant_id, ctx.tenantId!)));

      await tx.insert(LocationAudit).values({
        locationId: location.id,
        locationName: location.name,
        tenant_id: ctx.tenantId!,
        action: "restored",
        userId: ctx.user!.id,
      });
    });

    return { message: "Location restored successfully." };
  });
