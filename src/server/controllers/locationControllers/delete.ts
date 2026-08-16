import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Location } from "../../../db/schema/location.ts";
import { LocationAudit } from "../../../db/schema/locationAudit.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { and, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ROLES } from "../../../types/user.ts";

export const deleteLocationProcedure = adminMutation
  .input(z.object({ id: z.uuid() }))
  .mutation(async ({ ctx, input }) => {
    // Only full admins can delete locations
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can delete locations",
      })
    }

    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Block deletion of a location that still holds stock, rather than
    // silently orphaning it — Stock.location_id is onDelete: "cascade" on
    // a real hard delete, but this is a soft delete, so unblocked deletion
    // would just leave stock pointing at a location nobody can see anymore.
    const stockWithQty = await ctx.db
      .select({ id: Stock.id })
      .from(Stock)
      .where(
        and(
          eq(Stock.location_id, input.id),
          eq(Stock.tenant_id, ctx.tenantId),
          isNull(Stock.deletedAt),
          gt(Stock.qty, 0)
        )
      )

    if (stockWithQty.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot delete this location — it has stock on hand for ${stockWithQty.length} product${stockWithQty.length === 1 ? "" : "s"}. Clear stock first.`,
      })
    }

    const deletedLocation = await ctx.db.transaction(async (tx) => {
      const [location] = await tx
        .update(Location)
        .set({
          active: false,
          deletedAt: new Date(Date.now()),
          deletedBy: ctx.user?.id,
        })
        .where(and(eq(Location.id, input.id), eq(Location.tenant_id, ctx.tenantId!)))
        .returning()

      if (!location) return null

      await tx.insert(LocationAudit).values({
        locationId: location.id,
        locationName: location.name,
        tenant_id: ctx.tenantId!,
        action: "deleted",
        userId: ctx.user!.id,
      })

      return location
    })

    if (!deletedLocation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Location not found.",
      })
    }

    return { message: "Location deleted successfully." }
  })
