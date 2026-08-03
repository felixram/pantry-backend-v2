import { authedProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { and, asc, eq } from "drizzle-orm"
import { CountSortOrder } from "../../../db/schema/countSortOrder.ts"
import { z } from "zod"

export const getCountSortOrder = authedProcedure
  .input(z.object({ location_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
    }

    const rows = await ctx.db
      .select({
        category_id: CountSortOrder.category_id,
        product_id: CountSortOrder.product_id,
        sort_order: CountSortOrder.sort_order,
        excluded: CountSortOrder.excluded,
      })
      .from(CountSortOrder)
      .where(
        and(
          eq(CountSortOrder.tenant_id, ctx.tenantId),
          eq(CountSortOrder.location_id, input.location_id)
        )
      )
      .orderBy(asc(CountSortOrder.sort_order))

    return rows
  })
