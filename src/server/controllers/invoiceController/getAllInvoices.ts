import { and, eq, isNull, desc, sql, ilike, or } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { Location } from "../../../db/schema/location.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { getLocationFilter } from "../../../utils/locationFilter.ts"

export const getAllInvoicesProcedure = authedProcedure
  .input(
    z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      locationId: z.string().uuid().optional(),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
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

    // ADMIN can filter by any location or see all; MANAGER/USER are
    // hard-scoped to their own (and rejected if they explicitly request a
    // different one) — this was previously an unchecked pass-through.
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
        )!
      )
    }

    const results = await ctx.db
      .select({
        id: Invoice.id,
        from_email: Invoice.from_email,
        from_name: Invoice.from_name,
        subject: Invoice.subject,
        received_at: Invoice.received_at,
        original_file_name: Invoice.original_file_name,
        extraction_confidence: Invoice.extraction_confidence,
        matched_supplier_id: Invoice.matched_supplier_id,
        matched_purchase_order_id: Invoice.matched_purchase_order_id,
        status: Invoice.status,
        processing_error: Invoice.processing_error,
        reviewed_by: Invoice.reviewed_by,
        reviewed_at: Invoice.reviewed_at,
        createdAt: Invoice.createdAt,
        location_name: Location.name,
        totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
      })
      .from(Invoice)
      .leftJoin(Location, eq(Invoice.location_id, Location.id))
      .where(and(...conditions))
      .orderBy(desc(Invoice.createdAt))
      .limit(input.limit)
      .offset(input.offset)

    return {
      results,
      pagination: {
        total: results[0]?.totalCount ?? 0,
        limit: input.limit,
        offset: input.offset,
        page: Math.floor(input.offset / input.limit) + 1,
        totalPages: Math.ceil((results[0]?.totalCount ?? 0) / input.limit),
      },
    }
  })
