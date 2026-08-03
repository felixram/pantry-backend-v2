import z from "zod"
import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts"
import { ORDER_STATUS } from "../../../types/orders.ts"
import { eq } from "drizzle-orm"

/**
 * Unlock an APPROVED Purchase Order for editing by ADMIN
 *
 * This allows ADMIN to modify items and header fields on an approved PO.
 * The PO remains in APPROVED status but is flagged as unlocked.
 * All unlock actions are audited with a required reason.
 */
export const unlockPurchaseOrder = adminMutation
  .input(
    z.object({
      id: z.string(),
      reason: z.string().min(1, "Reason is required for unlocking"),
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

      // 2. Verify PO is in APPROVED status
      if (purchaseOrder.status !== ORDER_STATUS.approved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only APPROVED purchase orders can be unlocked. Current status: ${purchaseOrder.status}`,
        })
      }

      // 3. Check if already unlocked
      if (purchaseOrder.is_unlocked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Purchase order is already unlocked",
        })
      }

      // 4. Update PO with unlock fields
      await tx
        .update(PurchaseOrder)
        .set({
          is_unlocked: true,
          unlocked_by: ctx.user!.id,
          unlocked_at: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(PurchaseOrder.id, input.id))

      // 5. Create audit log entry
      await tx.insert(PurchaseOrderAudit).values({
        purchaseOrderId: input.id,
        userId: ctx.user!.id,
        fieldChanged: "unlock",
        oldValue: "locked",
        newValue: "unlocked",
        reason: input.reason,
      })

      return {
        success: true,
        message: "Purchase order unlocked for editing",
        purchaseOrderId: input.id,
      }
    })
  })
