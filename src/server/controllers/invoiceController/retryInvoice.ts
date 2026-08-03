import { and, eq, isNull } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { processInvoice } from "../../../services/invoice/invoiceProcessor.ts"

export const retryInvoiceProcedure = adminMutation
  .input(z.object({ invoiceId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const invoice = await ctx.db.query.Invoice.findFirst({
      where: and(
        eq(Invoice.id, input.invoiceId),
        eq(Invoice.tenant_id, ctx.tenantId),
        isNull(Invoice.deletedAt)
      ),
    })

    if (!invoice) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invoice not found",
      })
    }

    if (invoice.status !== INVOICE_STATUS.failed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only failed invoices can be retried",
      })
    }

    // Delete existing invoice items before reprocessing
    await ctx.db
      .delete(InvoiceItem)
      .where(eq(InvoiceItem.invoice_id, input.invoiceId))

    // Reset to PENDING and clear error
    await ctx.db
      .update(Invoice)
      .set({
        status: INVOICE_STATUS.pending,
        processing_error: null,
        extracted_data: null,
        extraction_confidence: null,
        matched_supplier_id: null,
        matched_purchase_order_id: null,
      })
      .where(eq(Invoice.id, input.invoiceId))

    // Trigger reprocessing (fire-and-forget)
    processInvoice(input.invoiceId, ctx.tenantId!).catch(() => {
      // Error is already handled inside processInvoice
    })

    return { message: "Invoice retry initiated" }
  })
