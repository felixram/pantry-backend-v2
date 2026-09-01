import { and, eq, isNull, sql, ilike, or, desc } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { Supplier } from "../../../db/schema/supplier.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { getLocationFilter } from "../../../utils/locationFilter.ts"

/**
 * Invoice counts grouped by matched supplier — the "Folders" view on the
 * invoices list. Honours the same tenant / location / status / search scope
 * as getAllInvoices so the folder counts always match what a drill-in shows.
 * Unmatched invoices (no matched_supplier_id) are returned as a separate
 * bucket rather than a group.
 */
export const getInvoiceSupplierGroupsProcedure = authedProcedure
  .input(
    z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      locationId: z.string().uuid().optional(),
    })
  )
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

    if (input.status) {
      conditions.push(eq(Invoice.status, input.status))
    }

    const locationFilter = getLocationFilter(ctx.user!, ctx.userLocationId, input.locationId)
    if (locationFilter) {
      conditions.push(eq(Invoice.location_id, locationFilter))
    }

    if (input.search) {
      const searchPattern = `%${input.search}%`
      conditions.push(
        or(
          ilike(Invoice.from_name, searchPattern),
          ilike(Invoice.from_email, searchPattern),
          ilike(Invoice.subject, searchPattern),
          ilike(Invoice.original_file_name, searchPattern),
          ilike(Invoice.invoice_number, searchPattern),
        )!
      )
    }

    // received_at can be null (manual entry / older rows) — fall back to
    // createdAt so a folder's "last activity" is never empty.
    const lastActivity = sql<string>`MAX(COALESCE(${Invoice.received_at}, ${Invoice.createdAt}))`

    const rows = await ctx.db
      .select({
        supplierId: Invoice.matched_supplier_id,
        supplierName: Supplier.name,
        count: sql<number>`COUNT(*)::int`,
        lastActivity: lastActivity.as("last_activity"),
      })
      .from(Invoice)
      .leftJoin(Supplier, eq(Invoice.matched_supplier_id, Supplier.id))
      .where(and(...conditions))
      .groupBy(Invoice.matched_supplier_id, Supplier.name)
      .orderBy(desc(lastActivity))

    const groups: {
      supplierId: string
      supplierName: string
      count: number
      lastActivity: string | null
    }[] = []
    let unmatched = { count: 0, lastActivity: null as string | null }

    for (const row of rows) {
      if (!row.supplierId) {
        unmatched = { count: row.count, lastActivity: row.lastActivity ?? null }
        continue
      }
      groups.push({
        supplierId: row.supplierId,
        supplierName: row.supplierName ?? "Unknown supplier",
        count: row.count,
        lastActivity: row.lastActivity ?? null,
      })
    }

    return { groups, unmatched }
  })
