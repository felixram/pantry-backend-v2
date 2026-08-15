import { and, eq, isNull, sql } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { getLocationFilter } from "../../../utils/locationFilter.ts"

export const getInvoiceStatsProcedure = authedProcedure
  .input(z.object({ locationId: z.string().uuid().optional() }).optional())
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const conditions = [
      eq(Invoice.tenant_id, ctx.tenantId),
      isNull(Invoice.deletedAt),
    ]

    // Was tenant-wide unconditionally — MANAGER/USER (and an ADMIN locked to
    // a location via the sidebar) saw the pending-review count for every
    // location, not just theirs, same gap getAllInvoicesProcedure already
    // closed for the list itself.
    const locationFilter = getLocationFilter(ctx.user!, ctx.userLocationId, input?.locationId)
    if (locationFilter) {
      conditions.push(eq(Invoice.location_id, locationFilter))
    }

    const stats = await ctx.db
      .select({
        status: Invoice.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(Invoice)
      .where(and(...conditions))
      .groupBy(Invoice.status)

    const statusCounts: Record<string, number> = {}
    for (const row of stats) {
      statusCounts[row.status] = row.count
    }

    return {
      pending: statusCounts[INVOICE_STATUS.pending] ?? 0,
      processing: statusCounts[INVOICE_STATUS.processing] ?? 0,
      review: statusCounts[INVOICE_STATUS.review] ?? 0,
      matched: statusCounts[INVOICE_STATUS.matched] ?? 0,
      confirmed: statusCounts[INVOICE_STATUS.confirmed] ?? 0,
      applied: statusCounts[INVOICE_STATUS.applied] ?? 0,
      failed: statusCounts[INVOICE_STATUS.failed] ?? 0,
      rejected: statusCounts[INVOICE_STATUS.rejected] ?? 0,
      pendingReview:
        (statusCounts[INVOICE_STATUS.review] ?? 0) +
        (statusCounts[INVOICE_STATUS.matched] ?? 0),
      total: stats.reduce((sum, row) => sum + row.count, 0),
    }
  })
