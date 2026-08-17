import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { Invoice } from "../../../db/schema/invoice.ts"
import { and, desc, eq, ilike, isNull, ne } from "drizzle-orm"

/**
 * Non-blocking nudge for the invoice review page: surfaces other invoices
 * from the same supplier already using this invoice number, so a reviewer
 * can catch an accidental re-scan of the same document. Never blocks
 * confirmation — a real invoice can legitimately be split across multiple
 * uploads sharing one number (e.g. "Part 1"/"Part 2" of one shipment), so
 * this is informational only, mirroring suggestOpenPO.ts's shape.
 */
export const checkDuplicateInvoiceNumberProcedure = authedProcedure
  .input(
    z.object({
      invoiceId: z.string().uuid(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const invoice = await ctx.db.query.Invoice.findFirst({
      where: and(eq(Invoice.id, input.invoiceId), eq(Invoice.tenant_id, ctx.tenantId)),
      columns: { invoice_number: true, matched_supplier_id: true },
    })

    // Nothing to compare without both a number and a matched supplier to
    // scope by — scoping tenant-wide would false-positive on suppliers that
    // coincidentally reuse simple numbering.
    if (!invoice?.invoice_number || !invoice.matched_supplier_id) {
      return { duplicates: [] }
    }

    const duplicates = await ctx.db.query.Invoice.findMany({
      where: and(
        eq(Invoice.tenant_id, ctx.tenantId),
        eq(Invoice.matched_supplier_id, invoice.matched_supplier_id),
        ilike(Invoice.invoice_number, invoice.invoice_number),
        ne(Invoice.id, input.invoiceId),
        isNull(Invoice.deletedAt)
      ),
      columns: { id: true, status: true, original_file_name: true, createdAt: true },
      orderBy: desc(Invoice.createdAt),
      limit: 5,
    })

    return { duplicates }
  })
