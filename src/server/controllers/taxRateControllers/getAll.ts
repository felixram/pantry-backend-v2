import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { and, eq, ilike, isNull, sql, getTableColumns } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const getAllTaxRatesProcedure = authedProcedure
  .input(
    z.object({
      search: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().optional().default(50),
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
      eq(TaxRate.tenant_id, ctx.tenantId),
      isNull(TaxRate.deletedAt),
    ]

    if (input.search) {
      conditions.push(ilike(TaxRate.name, `%${input.search}%`))
    }

    if (input.type) {
      conditions.push(eq(TaxRate.type, input.type))
    }

    const results = await ctx.db
      .select({
        ...getTableColumns(TaxRate),
        totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
      })
      .from(TaxRate)
      .where(and(...conditions))
      .limit(input.limit)
      .offset(input.offset)

    const totalCount = results[0]?.totalCount ?? 0

    return {
      results,
      pagination: {
        total: totalCount,
        limit: input.limit,
        offset: input.offset,
        page: Math.floor(input.offset / input.limit) + 1,
        totalPages: Math.ceil(totalCount / input.limit),
      },
    }
  })
