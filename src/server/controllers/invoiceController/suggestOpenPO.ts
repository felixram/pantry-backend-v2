import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { ORDER_STATUS } from "../../../types/orders.ts"

/**
 * Non-blocking nudge for the invoice review page: when an invoice's
 * supplier is matched but no PO is, this surfaces a supplier's open PO
 * (ORDERED or PARTIALLY_RECEIVED) so a reviewer doesn't forget to match one
 * that actually exists — poMatcher's auto-match only fires above a 0.3
 * item-overlap score, so a real match can go unfound. Never blocks
 * confirmation; a standalone purchase with no PO is legitimate.
 */
export const suggestOpenPOProcedure = authedProcedure
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

    const po = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(
        eq(PurchaseOrder.tenant_id, ctx.tenantId),
        eq(PurchaseOrder.supplier_id, input.supplierId),
        inArray(PurchaseOrder.status, [ORDER_STATUS.ordered, ORDER_STATUS.partiallyReceived]),
        isNull(PurchaseOrder.deletedAt)
      ),
      columns: { id: true, po_number: true, status: true },
    })

    if (!po) {
      return { suggestion: null }
    }

    return {
      suggestion: {
        id: po.id,
        po_number: po.po_number,
        status: po.status,
      },
    }
  })
