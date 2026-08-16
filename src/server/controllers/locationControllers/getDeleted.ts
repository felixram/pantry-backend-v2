import { authedProcedure } from "../../trpc.ts";
import { Location } from "../../../db/schema/location.ts";
import { LocationAudit } from "../../../db/schema/locationAudit.ts";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// No restore-window filtering, unlike getDeletedCategoriesProcedure/etc —
// locations have no purge cron (see restoreLocationProcedure's comment),
// so every soft-deleted location stays listed here indefinitely.
export const getDeletedLocationsProcedure = authedProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
  }

  const locations = await ctx.db.query.Location.findMany({
    where: and(eq(Location.tenant_id, ctx.tenantId), isNotNull(Location.deletedAt)),
    columns: { id: true, name: true, deletedAt: true },
    orderBy: (location) => [desc(location.deletedAt)],
  });

  if (locations.length === 0) {
    return { locations: [] };
  }

  const deleteEvents = await ctx.db.query.LocationAudit.findMany({
    where: and(
      eq(LocationAudit.tenant_id, ctx.tenantId),
      inArray(LocationAudit.locationId, locations.map((location) => location.id)),
      eq(LocationAudit.action, "deleted")
    ),
    columns: { locationId: true, createdAt: true },
    with: { user: { columns: { name: true } } },
    orderBy: (auditRow) => [desc(auditRow.createdAt)],
  });

  const deletedByNameByLocationId = new Map<string, string>();
  for (const event of deleteEvents) {
    if (event.locationId && !deletedByNameByLocationId.has(event.locationId)) {
      deletedByNameByLocationId.set(event.locationId, event.user?.name || "Unknown User");
    }
  }

  return {
    locations: locations.map((location) => ({
      ...location,
      deletedByName: deletedByNameByLocationId.get(location.id) ?? null,
    })),
  };
});
