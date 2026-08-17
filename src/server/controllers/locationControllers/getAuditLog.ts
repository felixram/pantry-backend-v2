import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { LocationAudit } from "../../../db/schema/locationAudit.ts";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getLocationFilter } from "../../../utils/locationFilter.ts";

export const getLocationAuditLogProcedure = authedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    // MANAGER/USER only see audit entries for their own location; ADMIN sees all.
    const scopedLocationId = getLocationFilter(ctx.user, ctx.userLocationId, undefined);

    const logs = await ctx.db.query.LocationAudit.findMany({
      where: and(
        eq(LocationAudit.tenant_id, ctx.tenantId),
        scopedLocationId ? eq(LocationAudit.locationId, scopedLocationId) : undefined
      ),
      columns: { id: true, locationId: true, locationName: true, action: true, reason: true, createdAt: true },
      with: { user: { columns: { name: true } } },
      orderBy: desc(LocationAudit.createdAt),
      limit: input.limit,
      offset: input.offset,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        locationId: log.locationId,
        locationName: log.locationName,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt,
        userName: log.user?.name || "Unknown User",
      })),
    };
  });
