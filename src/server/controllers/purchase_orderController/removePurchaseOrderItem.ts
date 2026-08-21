import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { isLocationScoped, type userRoles } from "../../../types/user.ts";
import { and, eq, isNull } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import {
  validatePermission,
  isTerminalStatusForRole,
  canEditUnlockedPO,
} from "./helpers/permissionMatrix.ts";

export const removePurchaseOrderItem = authedMutation
  .input(
    z.object({
      purchaseOrderId: z.string(),
      itemId: z.string(),
      reason: z.string().min(3, "Reason must be at least 3 characters"),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    return await ctx.db.transaction(async (tx) => {
      // 1. Get the purchase order with its items
      const purchaseOrder = await tx.query.PurchaseOrder.findFirst({
        where: and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId!)),
        with: {
          purchaseOrderItems: {
            where: isNull(PurchaseOrderItem.deletedAt),
            with: {
              product: true,
            },
          },
        },
      });

      if (!purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      // 1.1. Validate location access for location-scoped users
      if (purchaseOrder.destination_location_id) {
        validateLocationAccess(ctx.user!, ctx.userLocationId, purchaseOrder.destination_location_id);
      }

      // 2. Check if order is in a terminal state for this role
      const userRole = ctx.user!.role as userRoles;

      // Check if ADMIN is editing an unlocked APPROVED PO
      const isUnlockedEdit = canEditUnlockedPO(
        { status: purchaseOrder.status, is_unlocked: purchaseOrder.is_unlocked },
        userRole
      );

      // If not an unlocked edit, apply normal permission rules
      if (!isUnlockedEdit) {
        if (isTerminalStatusForRole(purchaseOrder.status, userRole)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot remove items from purchase order in ${purchaseOrder.status} state`,
          });
        }

        // 2.1. Validate permission to edit items using permission matrix
        validatePermission(
          userRole,
          purchaseOrder.status,
          "edit_items"
        );
      }

      // 3. Find the item
      const item = purchaseOrder.purchaseOrderItems.find(
        (i) => i.id === input.itemId
      );

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item not found in this purchase order",
        });
      }

      // 4. Store old value for audit
      const oldValue = {
        product_id: item.product_id,
        product_name: item.product?.name,
        qty: item.qty,
        unit_price: item.unit_price,
      };

      // 5. Soft-delete the item. Unlike v1, removing the last item does NOT
      // implicitly delete/cancel the parent PO — a PO with zero items is a
      // valid state (e.g. mid-edit in DRAFT); use the explicit Cancel/Delete
      // actions to end a PO's lifecycle instead of inferring it from item count.
      await tx
        .update(PurchaseOrderItem)
        .set({ deletedAt: new Date() })
        .where(eq(PurchaseOrderItem.id, input.itemId));

      // 6. Log change to audit table
      // - Skip for DRAFT orders
      // - Log for USER changes (non-draft)
      // - Log for ADMIN changes on unlocked POs
      const shouldAudit =
        purchaseOrder.status !== ORDER_STATUS.draft &&
        (isLocationScoped(ctx.user!.role) || isUnlockedEdit);

      if (shouldAudit) {
        await tx.insert(PurchaseOrderAudit).values({
          purchaseOrderId: input.purchaseOrderId,
          userId: ctx.user!.id,
          fieldChanged: "item_removed",
          oldValue: JSON.stringify(oldValue),
          newValue: "removed",
          reason: input.reason,
        });
      }

      return {
        message: "Item removed successfully",
        remainingItems: purchaseOrder.purchaseOrderItems.length - 1,
      };
    });
  });
