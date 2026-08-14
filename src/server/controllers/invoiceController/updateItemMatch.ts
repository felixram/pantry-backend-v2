import { and, eq, isNull, sql } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { ProductAlias } from "../../../db/schema/productAlias.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { recalculateInvoiceDiscrepancies } from "../../../services/invoice/poMatcher.ts"

export const updateItemMatchProcedure = adminMutation
  .input(
    z.object({
      invoiceItemId: z.string().uuid(),
      productId: z.string().uuid(),
      qty: z.number().nonnegative().optional(),
      unitPrice: z.number().nonnegative().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Verify the invoice item exists and belongs to this tenant
    const item = await ctx.db.query.InvoiceItem.findFirst({
      where: eq(InvoiceItem.id, input.invoiceItemId),
      with: {
        invoice: true,
      },
    })

    if (!item || item.invoice.tenant_id !== ctx.tenantId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invoice item not found",
      })
    }

    if (
      item.invoice.status === INVOICE_STATUS.applied ||
      item.invoice.status === INVOICE_STATUS.rejected
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot modify items on a finalized invoice",
      })
    }

    const updateData: Record<string, unknown> = {
      confirmed_product_id: input.productId,
      match_method: "manual",
    }

    if (input.qty !== undefined) {
      updateData.confirmed_qty = input.qty
    }

    if (input.unitPrice !== undefined) {
      updateData.confirmed_unit_price = input.unitPrice
    }

    await ctx.db
      .update(InvoiceItem)
      .set(updateData)
      .where(eq(InvoiceItem.id, input.invoiceItemId))

    // Product/qty/price all feed the discrepancy calc — recompute for the
    // whole invoice since qty discrepancy is an aggregate across every line
    // sharing this item's matched PO item, not just this one.
    await recalculateInvoiceDiscrepancies(ctx.db, item.invoice.id, ctx.tenantId)

    // Upsert product alias if we have a supplier and extracted name
    if (
      item.invoice.matched_supplier_id &&
      item.extracted_name &&
      input.productId !== item.matched_product_id
    ) {
      await ctx.db
        .insert(ProductAlias)
        .values({
          tenant_id: ctx.tenantId!,
          supplier_id: item.invoice.matched_supplier_id,
          alias_name: item.extracted_name,
          product_id: input.productId,
          source_invoice_item_id: item.id,
        })
        .onConflictDoUpdate({
          target: [
            ProductAlias.tenant_id,
            ProductAlias.supplier_id,
            ProductAlias.alias_name,
          ],
          set: {
            product_id: input.productId,
            use_count: sql`${ProductAlias.use_count} + 1`,
            source_invoice_item_id: item.id,
          },
        })
    }

    return { message: "Item match updated" }
  })
