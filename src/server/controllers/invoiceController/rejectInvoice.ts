import { and, eq, isNull } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const rejectInvoiceProcedure = adminMutation
  .input(
    z.object({
      invoiceId: z.string().uuid(),
      reason: z.string().min(1, "Rejection reason is required"),
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

    if (
      invoice.status === INVOICE_STATUS.applied ||
      invoice.status === INVOICE_STATUS.rejected
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot reject invoice in ${invoice.status} status`,
      })
    }

    await ctx.db
      .update(Invoice)
      .set({
        status: INVOICE_STATUS.rejected,
        reviewed_by: ctx.user!.id,
        reviewed_at: new Date(),
        review_notes: input.reason,
      })
      .where(eq(Invoice.id, input.invoiceId))

    return { message: "Invoice rejected" }
  })
