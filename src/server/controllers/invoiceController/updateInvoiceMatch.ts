import { eq, and } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { calculateItemDiscrepancies } from "../../../services/invoice/poMatcher.ts"
import type { InvoiceLineForMatching } from "../../../services/invoice/poMatcher.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const updateInvoiceMatchProcedure = adminMutation
  .input(
    z.object({
      invoiceId: z.string().uuid(),
      supplierId: z.string().uuid().nullable().optional(),
      purchaseOrderId: z.string().uuid().nullable().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const invoice = await ctx.db.query.Invoice.findFirst({
      where: eq(Invoice.id, input.invoiceId),
      with: { items: true },
    })

    if (!invoice || invoice.tenant_id !== ctx.tenantId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invoice not found",
      })
    }

    if (
      invoice.status === INVOICE_STATUS.applied ||
      invoice.status === INVOICE_STATUS.rejected
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot modify a finalized invoice",
      })
    }

    const updateData: Record<string, unknown> = {}

    if (input.supplierId !== undefined) {
      updateData.matched_supplier_id = input.supplierId
    }

    if (input.purchaseOrderId !== undefined) {
      updateData.matched_purchase_order_id = input.purchaseOrderId
    }

    if (Object.keys(updateData).length === 0) {
      return { message: "No changes" }
    }

    await ctx.db
      .update(Invoice)
      .set(updateData)
      .where(eq(Invoice.id, input.invoiceId))

    // When PO is changed, re-match invoice items to PO items and recalculate discrepancies
    if (input.purchaseOrderId !== undefined) {
      await rematchItemsToPO(ctx.db, invoice.items, input.purchaseOrderId, ctx.tenantId!)
    }

    return { message: "Invoice match updated" }
  })

/**
 * Re-match invoice items to PO items and recalculate discrepancies.
 * Called when the matched PO is manually changed.
 */
async function rematchItemsToPO(
  db: any,
  items: any[],
  purchaseOrderId: string | null,
  tenantId: string
) {
  // PO cleared — remove all PO item matches and discrepancies
  if (!purchaseOrderId) {
    for (const item of items) {
      await db
        .update(InvoiceItem)
        .set({
          matched_po_item_id: null,
          has_qty_discrepancy: false,
          has_price_discrepancy: false,
          qty_discrepancy_amount: null,
          price_discrepancy_amount: null,
        })
        .where(eq(InvoiceItem.id, item.id))
    }
    return
  }

  // Load PO items (scoped by tenant via the invoice's tenant_id)
  const po = await db.query.PurchaseOrder.findFirst({
    where: and(eq(PurchaseOrder.id, purchaseOrderId), eq(PurchaseOrder.tenant_id, tenantId)),
    with: { purchaseOrderItems: true },
  })

  if (!po) return

  const poItems = po.purchaseOrderItems.map((item: any) => ({
    poItemId: item.id,
    productId: item.product_id,
    qty: item.qty,
    unitPrice: item.unit_price,
  }))

  // Normalize DB invoice items into the shared format
  const linesForMatching: InvoiceLineForMatching[] = items.map((item: any) => ({
    productId: item.confirmed_product_id || item.matched_product_id,
    qty: item.confirmed_qty ?? item.extracted_qty ?? 0,
    unitPrice: item.confirmed_unit_price ?? item.extracted_unit_price ?? 0,
    discountPercent: item.extracted_discount_percent ?? 0,
    isOOS: item.is_out_of_stock ?? false,
  }))

  const discrepancies = calculateItemDiscrepancies(linesForMatching, poItems)

  // Persist results
  for (let i = 0; i < items.length; i++) {
    const d = discrepancies[i]!
    await db
      .update(InvoiceItem)
      .set({
        matched_po_item_id: d.matchedPoItemId,
        has_qty_discrepancy: d.hasQtyDiscrepancy,
        has_price_discrepancy: d.hasPriceDiscrepancy,
        qty_discrepancy_amount: d.qtyDiscrepancyAmount,
        price_discrepancy_amount: d.priceDiscrepancyAmount,
      })
      .where(eq(InvoiceItem.id, items[i]!.id))
  }
}
