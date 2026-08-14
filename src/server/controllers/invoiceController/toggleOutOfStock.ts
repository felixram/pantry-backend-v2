import { eq } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { recalculateInvoiceDiscrepancies } from "../../../services/invoice/poMatcher.ts"

export const toggleOutOfStockProcedure = adminMutation
  .input(
    z.object({
      invoiceItemId: z.string().uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

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

    const newValue = !item.is_out_of_stock

    await ctx.db
      .update(InvoiceItem)
      .set({ is_out_of_stock: newValue })
      .where(eq(InvoiceItem.id, input.invoiceItemId))

    // The OOS flag feeds into the aggregate qty-discrepancy calc for every
    // line sharing this item's matched PO item, not just this one.
    await recalculateInvoiceDiscrepancies(ctx.db, item.invoice.id, ctx.tenantId)

    return { is_out_of_stock: newValue }
  })
