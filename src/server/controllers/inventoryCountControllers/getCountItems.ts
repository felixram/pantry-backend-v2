import { adminProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Stock } from "../../../db/schema/stock.ts"
import { CountSortOrder } from "../../../db/schema/countSortOrder.ts"
import { z } from "zod"

export const getCountItems = adminProcedure
  .input(z.object({ location_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
    }

    // Fetch all stock at this location with product + category data
    const stocks = await ctx.db.query.Stock.findMany({
      where: and(
        eq(Stock.tenant_id, ctx.tenantId),
        eq(Stock.location_id, input.location_id)
      ),
      with: {
        product: {
          columns: { id: true, name: true, sku: true, deletedAt: true },
          with: {
            category: {
              columns: { id: true, name: true },
            },
          },
        },
      },
    })

    // Filter out soft-deleted products
    const activeStocks = stocks.filter((s) => s.product && !s.product.deletedAt)

    const items = activeStocks.map((s) => ({
      stock_id: s.id,
      product_id: s.product!.id,
      product_name: s.product!.name,
      sku: s.product!.sku,
      category_id: s.product!.category?.id ?? null,
      category_name: s.product!.category?.name ?? null,
    }))

    // Fetch existing sort order
    const sortOrder = await ctx.db
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

    return { items, sortOrder }
  })
