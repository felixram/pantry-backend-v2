import { and, eq, isNull } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const getInvoiceByIdProcedure = authedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const invoice = await ctx.db.query.Invoice.findFirst({
      where: and(
        eq(Invoice.id, input.id),
        eq(Invoice.tenant_id, ctx.tenantId),
        isNull(Invoice.deletedAt)
      ),
      with: {
        items: {
          with: {
            matchedProduct: true,
            confirmedProduct: true,
            matchedPoItem: {
              with: {
                product: true,
              },
            },
          },
        },
        location: true,
        matchedSupplier: true,
        matchedPurchaseOrder: {
          with: {
            purchaseOrderItems: {
              with: {
                product: true,
              },
            },
          },
        },
        reviewedByUser: true,
      },
    })

    if (!invoice) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invoice not found",
      })
    }

    return invoice
  })
