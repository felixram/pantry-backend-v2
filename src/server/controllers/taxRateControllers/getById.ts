import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { Product } from "../../../db/schema/product.ts"
import { Category } from "../../../db/schema/category.ts"
import { Location } from "../../../db/schema/location.ts"
import { and, count, eq, isNull, or } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const getTaxRateByIdProcedure = authedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const taxRate = await ctx.db.query.TaxRate.findFirst({
      where: and(
        eq(TaxRate.id, input.id),
        eq(TaxRate.tenant_id, ctx.tenantId),
        isNull(TaxRate.deletedAt)
      ),
    })

    if (!taxRate) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Tax rate not found",
      })
    }

    // Reference counts so a delete confirmation can warn before silently
    // degrading these products/categories/locations to 0% tax — v1 deleted
    // a referenced tax rate with no warning at all.
    const [[productRow], [categoryRow], [locationRow]] = await Promise.all([
      ctx.db
        .select({ value: count() })
        .from(Product)
        .where(and(eq(Product.tenant_id, ctx.tenantId), eq(Product.tax_rate_id, input.id), isNull(Product.deletedAt))),
      ctx.db
        .select({ value: count() })
        .from(Category)
        .where(and(eq(Category.tenant_id, ctx.tenantId), eq(Category.tax_rate_id, input.id), isNull(Category.deletedAt))),
      ctx.db
        .select({ value: count() })
        .from(Location)
        .where(
          and(
            eq(Location.tenant_id, ctx.tenantId),
            or(eq(Location.default_purchase_tax_rate_id, input.id), eq(Location.default_sales_tax_rate_id, input.id)),
            isNull(Location.deletedAt)
          )
        ),
    ])

    return {
      ...taxRate,
      usage: {
        products: productRow?.value ?? 0,
        categories: categoryRow?.value ?? 0,
        locations: locationRow?.value ?? 0,
      },
    }
  })
