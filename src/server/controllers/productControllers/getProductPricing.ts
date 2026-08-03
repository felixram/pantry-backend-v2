import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { and, eq, isNull } from "drizzle-orm"
import { Product } from "../../../db/schema/product.ts"
import { Location } from "../../../db/schema/location.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { TRPCError } from "@trpc/server"
import { resolveApplicableTaxRate } from "../../../utils/taxResolution.ts"

export const getProductPricingProcedure = authedProcedure
  .input(
    z.object({
      locationId: z.string().uuid(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const location = await ctx.db.query.Location.findFirst({
      where: and(
        eq(Location.id, input.locationId),
        eq(Location.tenant_id, ctx.tenantId),
        isNull(Location.deletedAt)
      ),
    })

    if (!location) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Location not found",
      })
    }

    const products = await ctx.db.query.Product.findMany({
      where: and(
        eq(Product.tenant_id, ctx.tenantId),
        isNull(Product.deletedAt)
      ),
      with: {
        version: true,
        category: true,
      },
    })

    // Pre-fetch all tax rates for this tenant
    const taxRates = await ctx.db.query.TaxRate.findMany({
      where: and(
        eq(TaxRate.tenant_id, ctx.tenantId),
        isNull(TaxRate.deletedAt)
      ),
    })
    const taxRateMap = new Map(taxRates.map((tr) => [tr.id, tr]))

    const pricingResults = products.map((product) => {
      const sellingPrice = product.version?.sellingPrice ?? 0

      const { taxRateId, isExempt } = resolveApplicableTaxRate({
        product: {
          is_tax_exempt: product.is_tax_exempt,
          tax_rate_id: product.tax_rate_id,
        },
        category: product.category
          ? {
              is_tax_exempt: product.category.is_tax_exempt,
              tax_rate_id: product.category.tax_rate_id,
            }
          : null,
        locationTaxRateId: location.default_sales_tax_rate_id,
      })

      const resolvedRate = taxRateId ? taxRateMap.get(taxRateId) : null
      const ratePercent = resolvedRate?.rate ?? 0
      const taxAmount = isExempt ? 0 : sellingPrice * (ratePercent / 100)
      const taxInclusivePrice = sellingPrice + taxAmount

      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        sellingPrice,
        isExempt,
        taxRateId: resolvedRate?.id ?? null,
        taxRateName: resolvedRate?.name ?? null,
        taxRatePercent: ratePercent,
        taxAmount: Math.round(taxAmount * 100) / 100,
        taxInclusivePrice: Math.round(taxInclusivePrice * 100) / 100,
      }
    })

    return { locationId: input.locationId, products: pricingResults }
  })
