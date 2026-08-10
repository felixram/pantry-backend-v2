import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { Product } from "../../../db/schema/product.ts"
import { eq, and, count } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const getByIdCategoryProcedure = authedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const category = await ctx.db.query.Category.findFirst({
      where: and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId)),
      with: { taxRate: { columns: { id: true, name: true, rate: true } } },
    })

    if (!category)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Category not found.",
      })

    const [productCount] = await ctx.db
      .select({ count: count() })
      .from(Product)
      .where(and(eq(Product.category_id, input.id), eq(Product.tenant_id, ctx.tenantId)))

    return {
      ...category,
      product_count: productCount?.count || 0,
    }
  })
