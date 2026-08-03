import { eq } from "drizzle-orm"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const toggleItemTaxableProcedure = adminMutation
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

    const newValue = !item.is_taxable

    await ctx.db
      .update(InvoiceItem)
      .set({ is_taxable: newValue })
      .where(eq(InvoiceItem.id, input.invoiceItemId))

    return { is_taxable: newValue }
  })
