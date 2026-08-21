import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts";
import { Product } from "../../../db/schema/product.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { isLocationScoped, type userRoles } from "../../../types/user.ts";
import { and, eq, isNull } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import {
  validatePermission,
  isTerminalStatusForRole,
  canEditUnlockedPO,
} from "./helpers/permissionMatrix.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const addPurchaseOrderItem = authedMutation
  .input(
    z.object({
      purchaseOrderId: z.string(),
      product_id: z.string(),
      qty: z.number().positive(),
      unit_price: z.number().nonnegative(),
      unit: z.string().optional(),
      reason: z.string().optional(),
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
      // 1. Get the purchase order
      const purchaseOrder = await tx.query.PurchaseOrder.findFirst({
        where: and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId!)),
        with: {
          purchaseOrderItems: {
            where: isNull(PurchaseOrderItem.deletedAt),
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

      // 2. Check permissions
      const userRole = ctx.user!.role as userRoles;

      // Check if elevated role is editing an unlocked APPROVED PO
      const isUnlockedEdit = canEditUnlockedPO(
        { status: purchaseOrder.status, is_unlocked: purchaseOrder.is_unlocked },
        userRole
      );

      // If not an unlocked edit, apply normal permission rules
      if (!isUnlockedEdit) {
        if (isTerminalStatusForRole(purchaseOrder.status, userRole)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot add items to purchase order in ${purchaseOrder.status} state`,
          });
        }

        // 2.1. Validate permission to edit items using permission matrix
        validatePermission(
          userRole,
          purchaseOrder.status,
          "edit_items"
        );
      }

      // 3. Verify product exists
      const product = await tx.query.Product.findFirst({
        where: and(eq(Product.id, input.product_id), eq(Product.tenant_id, ctx.tenantId!)),
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Product with id ${input.product_id} not found`,
        });
      }

      // 3.1. Resolve the unit's conversion factor (also validates the unit
      // exists for this product) and snapshot it for receiving later.
      const { factor: unitConversionFactor } = await resolveUnitFactor(
        tx,
        input.product_id,
        ctx.tenantId!,
        input.unit
      );

      // 4. Check if product already exists in this PO
      const existingItem = purchaseOrder.purchaseOrderItems.find(
        (item) => item.product_id === input.product_id
      );

      if (existingItem) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Product already exists in this purchase order. Use updateItem to modify the quantity.`,
        });
      }

      // 5. Insert new item
      const newItem = await tx
        .insert(PurchaseOrderItem)
        .values({
          purchase_order_id: input.purchaseOrderId,
          product_id: input.product_id,
          qty: input.qty,
          unit_price: input.unit_price,
          unit: input.unit,
          unit_conversion_factor: unitConversionFactor,
        })
        .returning();

      // 5.1. Update defaultUnit for the product (last used unit becomes default)
      if (input.unit) {
        await tx
          .update(Product)
          .set({ defaultUnit: input.unit })
          .where(eq(Product.id, input.product_id));
      }

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
          fieldChanged: "item_added",
          oldValue: "null",
          newValue: JSON.stringify({
            product_id: input.product_id,
            product_name: product.name,
            qty: input.qty,
            unit_price: input.unit_price,
            unit: input.unit,
          }),
          reason: input.reason || "Item added",
        });
      }

      const insertedItem = newItem[0];

      return {
        message: "Item added successfully",
        item: {
          id: insertedItem?.id,
          product_id: insertedItem?.product_id,
          qty: insertedItem?.qty,
          unit_price: insertedItem?.unit_price,
          unit: insertedItem?.unit,
          product,
        },
      };
    });
  });
