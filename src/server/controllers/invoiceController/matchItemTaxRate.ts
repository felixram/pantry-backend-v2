import { and, eq, isNull } from "drizzle-orm"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const matchItemTaxRateProcedure = adminMutation
  .input(
    z.object({
      invoiceItemId: z.string().uuid(),
      // null clears the reviewer's pick, falling back to the auto-match (or none).
      taxRateId: z.string().uuid().nullable(),
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

    if (input.taxRateId) {
      const taxRate = await ctx.db.query.TaxRate.findFirst({
        where: and(eq(TaxRate.id, input.taxRateId), eq(TaxRate.tenant_id, ctx.tenantId), isNull(TaxRate.deletedAt)),
        columns: { id: true },
      })
      if (!taxRate) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tax rate not found" })
      }
    }

    await ctx.db
      .update(InvoiceItem)
      .set({ confirmed_tax_rate_id: input.taxRateId })
      .where(eq(InvoiceItem.id, input.invoiceItemId))

    return { confirmed_tax_rate_id: input.taxRateId }
  })
