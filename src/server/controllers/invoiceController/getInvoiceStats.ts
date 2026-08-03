import { and, eq, isNull, sql } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { authedProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"

export const getInvoiceStatsProcedure = authedProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Tenant context required",
    })
  }

  const stats = await ctx.db
    .select({
      status: Invoice.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(Invoice)
    .where(
      and(
        eq(Invoice.tenant_id, ctx.tenantId),
        isNull(Invoice.deletedAt)
      )
    )
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
