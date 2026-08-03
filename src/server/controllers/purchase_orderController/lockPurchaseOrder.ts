import z from "zod"
import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts"
import { eq } from "drizzle-orm"

/**
 * Lock an unlocked Purchase Order after ADMIN editing
 *
 * This re-locks an APPROVED PO that was previously unlocked for editing.
 * Lock actions are audited (reason is optional).
 */
export const lockPurchaseOrder = adminMutation
  .input(
    z.object({
      id: z.string(),
      reason: z.string().optional().default(""),
    })
  )
  .mutation(async ({ ctx, input }) => {
    return await ctx.db.transaction(async (tx) => {
      // 1. Get the current purchase order
      const purchaseOrder = await tx.query.PurchaseOrder.findFirst({
        where: eq(PurchaseOrder.id, input.id),
      })

      if (!purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        })
      }

      // 2. Check if the PO is unlocked
      if (!purchaseOrder.is_unlocked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Purchase order is not unlocked",
        })
      }

      // 3. Clear unlock fields
      await tx
        .update(PurchaseOrder)
        .set({
          is_unlocked: false,
          unlocked_by: null,
          unlocked_at: null,
          updatedAt: new Date(),
        })
        .where(eq(PurchaseOrder.id, input.id))

      // 4. Create audit log entry
      await tx.insert(PurchaseOrderAudit).values({
        purchaseOrderId: input.id,
        userId: ctx.user!.id,
        fieldChanged: "lock",
        oldValue: "unlocked",
        newValue: "locked",
        reason: input.reason,
      })

      return {
        success: true,
        message: "Purchase order locked",
        purchaseOrderId: input.id,
      }
    })
  })
