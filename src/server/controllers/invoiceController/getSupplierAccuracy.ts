import { eq, and } from "drizzle-orm"
import { SupplierInvoiceProfile } from "../../../db/schema/supplierInvoiceProfile.ts"
import { adminProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const getSupplierAccuracyProcedure = adminProcedure
  .input(
    z.object({
      supplierId: z.string().uuid(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const profile = await ctx.db.query.SupplierInvoiceProfile.findFirst({
      where: and(
        eq(SupplierInvoiceProfile.tenant_id, ctx.tenantId),
        eq(SupplierInvoiceProfile.supplier_id, input.supplierId)
      ),
    })

    if (!profile) {
      return {
        hasData: false,
        supplierId: input.supplierId,
        totalInvoicesProcessed: 0,
        totalItemsProcessed: 0,
        productMatchAccuracy: null,
        priceExtractionAccuracy: null,
        qtyExtractionAccuracy: null,
        overallAccuracy: null,
        hasDiscountColumn: null,
        defaultTaxBehavior: null,
        lastRebuiltAt: null,
      }
    }

    return {
      hasData: true,
      supplierId: input.supplierId,
      totalInvoicesProcessed: profile.total_invoices_processed,
      totalItemsProcessed: profile.total_items_processed,
      productMatchAccuracy: profile.product_match_accuracy,
      priceExtractionAccuracy: profile.price_extraction_accuracy,
      qtyExtractionAccuracy: profile.qty_extraction_accuracy,
      overallAccuracy: profile.overall_accuracy,
      hasDiscountColumn: profile.has_discount_column,
      defaultTaxBehavior: profile.default_tax_behavior,
      lastRebuiltAt: profile.last_rebuilt_at,
    }
  })
