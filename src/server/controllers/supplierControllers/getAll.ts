import { ilike, or, sql, and, isNull, getTableColumns, asc, desc, eq } from "drizzle-orm"
import { Supplier } from "../../../db/schema/supplier.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const getAllSupplierProcedure = authedProcedure
  .input(
    z.object({
      search: z.string().optional(),
      includeDeleted: z.boolean().default(false).optional(),
      limit: z.number().optional().default(10),
      offset: z.number().optional().default(0),
      sortByType: z.enum(["asc", "desc"]).optional(),
      supplier_type: z.enum(["PRIMARY", "SECONDARY"]).optional(),
      columns: z.array(z.enum(["id", "name"])).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Determine order by clause based on sortByType
    const orderByClause = input.sortByType
      ? input.sortByType === "asc"
        ? [asc(Supplier.supplier_type), desc(Supplier.id)]
        : [desc(Supplier.supplier_type), asc(Supplier.id)]
      : [desc(Supplier.id)]

    // When columns param is provided, return only requested fields (lightweight for dropdowns)
    const selectFields = input.columns
      ? {
          ...(input.columns.includes("id") ? { id: Supplier.id } : {}),
          ...(input.columns.includes("name") ? { name: Supplier.name } : {}),
          totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
        }
      : {
          ...getTableColumns(Supplier),
          totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
        }

    const results = await ctx.db
      .select(selectFields)
      .from(Supplier)
      .where(
        and(
          eq(Supplier.tenant_id, ctx.tenantId),
          input.search
            ? or(
                ilike(Supplier.name, `%${input.search}%`),
                ilike(Supplier.contact_name, `%${input.search}%`),
                ilike(Supplier.phone, `%${input.search}%`),
                ilike(Supplier.email, `%${input.search}%`)
              )
            : sql`TRUE`,
          input.includeDeleted ? sql`TRUE` : isNull(Supplier.deletedAt),
          input.supplier_type ? eq(Supplier.supplier_type, input.supplier_type) : sql`TRUE`
        )
      )
      .orderBy(...orderByClause)
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
