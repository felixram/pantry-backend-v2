import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { isLocationScoped, type userRoles } from "../../../types/user.ts";
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts";
import { canEditUnlockedPO } from "./helpers/permissionMatrix.ts";

export const addItemsToPurchaseOrder = authedMutation
  .input(
    z.object({
      purchaseOrderId: z.uuid(),
      items: z
        .array(
          z.object({
            product_id: z.uuid(),
            qty: z.number().positive(),
            unit_price: z.number().nonnegative(),
            unit: z.string().optional(),
          })
        )
        .min(1, "At least one item is required"),
      reason: z.string().default("Items added during PO creation"),
    })
  )
  .mutation(async ({ ctx, input }) => {
    await ctx.db.transaction(async (tx) => {
      // Get the purchase order
      const purchaseOrder = await tx.query.PurchaseOrder.findFirst({
        where: eq(PurchaseOrder.id, input.purchaseOrderId),
      });

      if (!purchaseOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found.",
        });
      }

      // Check if ADMIN is editing an unlocked APPROVED PO
      const userRole = ctx.user!.role as userRoles;
      const isUnlockedEdit = canEditUnlockedPO(
        { status: purchaseOrder.status, is_unlocked: purchaseOrder.is_unlocked },
        userRole
      );

      // Check if PO is in a terminal state (skip for unlocked APPROVED PO with ADMIN)
      if (!isUnlockedEdit) {
        if (
          purchaseOrder.status === ORDER_STATUS.cancelled ||
          purchaseOrder.status === ORDER_STATUS.rejected ||
          purchaseOrder.status === ORDER_STATUS.ordered ||
          purchaseOrder.status === ORDER_STATUS.received ||
          purchaseOrder.status === ORDER_STATUS.approved ||
          purchaseOrder.status === ORDER_STATUS.pendingApproval
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot add items to a purchase order with status ${purchaseOrder.status}`,
          });
        }
      }

      // Validate all products exist
      for (const item of input.items) {
        const product = await tx.query.Product.findFirst({
          where: eq(Product.id, item.product_id),
        });

        if (!product) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product with ID ${item.product_id} not found.`,
          });
        }
      }

      // Check for duplicate products in the input
      const productIds = input.items.map((item) => item.product_id);
      const uniqueProductIds = new Set(productIds);
      if (productIds.length !== uniqueProductIds.size) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Duplicate products in the item list. Each product can only appear once.",
        });
      }

      // Check if any product already exists in the PO
      for (const item of input.items) {
        const existingItem = await tx.query.PurchaseOrderItem.findFirst({
          where: and(
            eq(PurchaseOrderItem.purchase_order_id, input.purchaseOrderId),
            eq(PurchaseOrderItem.product_id, item.product_id)
          ),
        });

        if (existingItem) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Product ${item.product_id} already exists in this purchase order.`,
          });
        }
      }

      // Add all items in a single transaction
      await tx.insert(PurchaseOrderItem).values(
        input.items.map((item) => ({
          purchase_order_id: input.purchaseOrderId,
          product_id: item.product_id,
          qty: item.qty,
          unit_price: item.unit_price,
          unit: item.unit,
        }))
      );

      // Update defaultUnit for each product (last used unit becomes default)
      for (const item of input.items) {
        if (item.unit) {
          await tx
            .update(Product)
            .set({ defaultUnit: item.unit })
            .where(eq(Product.id, item.product_id));
        }
      }

      // Audit log:
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
          fieldChanged: "items_added",
          oldValue: "[]",
          newValue: JSON.stringify(input.items),
          reason: input.reason,
        });
      }
    });

    return {
      message: `Added ${input.items.length} item(s) to purchase order.`,
    };
  });
