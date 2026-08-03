import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts";
import { Product } from "../../../db/schema/product.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { isLocationScoped, type userRoles } from "../../../types/user.ts";
import { eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import {
  validatePermission,
  isTerminalStatusForRole,
  canEditUnlockedPO,
} from "./helpers/permissionMatrix.ts";

export const updatePurchaseOrderItem = authedMutation
  .input(
    z.object({
      purchaseOrderId: z.string(),
      itemId: z.string(),
      qty: z.number().positive().optional(),
      unit_price: z.number().nonnegative().optional(),
      unit: z.string().optional(),
      reason: z.string().min(3, "Reason must be at least 3 characters"),
    })
  )
  .mutation(async ({ ctx, input }) => {
    return await ctx.db.transaction(async (tx) => {
      // 1. Get the purchase order with its items
      const purchaseOrder = await tx.query.PurchaseOrder.findFirst({
        where: eq(PurchaseOrder.id, input.purchaseOrderId),
        with: {
          purchaseOrderItems: {
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
            message: `Cannot update items in purchase order in ${purchaseOrder.status} state`,
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

      // 4. Validate at least one field is being updated
      if (input.qty === undefined && input.unit_price === undefined && input.unit === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one field (qty, unit_price, or unit) must be updated",
        });
      }

      // 5. Store old values for audit
      const oldValue = {
        qty: item.qty,
        unit_price: item.unit_price,
        unit: item.unit,
      };

      // 6. Update the item
      const newQty = input.qty !== undefined ? input.qty : item.qty;
      const newUnitPrice =
        input.unit_price !== undefined ? input.unit_price : item.unit_price;
      const newUnit = input.unit !== undefined ? input.unit : item.unit;

      const updatedItem = await tx
        .update(PurchaseOrderItem)
        .set({
          qty: newQty,
          unit_price: newUnitPrice,
          unit: newUnit,
        })
        .where(eq(PurchaseOrderItem.id, input.itemId))
        .returning();

      // 6.1. Update defaultUnit for the product if unit was changed
      if (input.unit && item.product_id) {
        await tx
          .update(Product)
          .set({ defaultUnit: input.unit })
          .where(eq(Product.id, item.product_id));
      }

      // 7. Log change to audit table
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
          fieldChanged: "item_updated",
          oldValue: JSON.stringify(oldValue),
          newValue: JSON.stringify({
            qty: newQty,
            unit_price: newUnitPrice,
            unit: newUnit,
          }),
          reason: input.reason,
        });
      }

      return {
        message: "Item updated successfully",
        item: {
          ...updatedItem[0],
          product: item.product,
        },
      };
    });
  });
