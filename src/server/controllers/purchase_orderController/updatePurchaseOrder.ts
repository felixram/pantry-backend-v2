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
import { receivePurchaseOrder } from "./helpers/receivePurchaseOrder.ts";
import {
  validateRoleStatusTransition,
  isTerminalStateForRole,
} from "./helpers/statusValidation.ts";
import {
  validatePermission,
  canEditUnlockedPO,
} from "./helpers/permissionMatrix.ts";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";

export const updatePurchaseOrder = authedMutation
  .input(
    z.object({
      purchaseOrderId: z.string(),
      status: z
        .enum([
          ORDER_STATUS.draft,
          ORDER_STATUS.pendingApproval,
          ORDER_STATUS.approved,
          ORDER_STATUS.ordered,
          ORDER_STATUS.partiallyReceived,
          ORDER_STATUS.rejected,
          ORDER_STATUS.cancelled,
          ORDER_STATUS.received,
        ] as const)
        .optional(),
      destination_location_id: z.string().optional(),
      supplier_id: z.string().optional(),
      items: z
        .array(
          z.object({
            product_id: z.string(),
            qty: z.number().positive(),
            unit_price: z.number().nonnegative(),
          }),
        )
        .optional(),
      // Received items with actual quantities (for receiving workflow)
      receivedItems: z
        .array(
          z.object({
            itemId: z.string(),
            receivedQty: z.number().nonnegative(),
            notes: z.string().optional(),
          }),
        )
        .optional(),
      reason: z.string().optional().default(""),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    return await ctx.db.transaction(async (tx) => {
      // 1. Get the current purchase order
      const existingOrder = await tx.query.PurchaseOrder.findFirst({
        where: and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId!)),
        with: {
          purchaseOrderItems: {
            where: isNull(PurchaseOrderItem.deletedAt),
          },
        },
      });

      if (!existingOrder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      // Validate user has access to this PO's destination location
      if (existingOrder.destination_location_id) {
        validateLocationAccess(
          ctx.user!,
          ctx.userLocationId,
          existingOrder.destination_location_id
        );
      }

      // If changing destination location, validate user has access to the new location
      if (input.destination_location_id) {
        validateLocationAccess(
          ctx.user!,
          ctx.userLocationId,
          input.destination_location_id
        );
      }

      // 2. Check if order is in a terminal state for this role
      const userRole = ctx.user!.role as userRoles;

      // Check if ADMIN is editing an unlocked APPROVED PO
      const isUnlockedEdit = canEditUnlockedPO(
        { status: existingOrder.status, is_unlocked: existingOrder.is_unlocked },
        userRole
      );

      // If not an unlocked edit, apply normal permission rules
      if (!isUnlockedEdit) {
        if (isTerminalStateForRole(existingOrder.status, userRole)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot update purchase order in ${existingOrder.status} state`,
          });
        }

        // 2.1. Validate header changes using permission matrix
        if (input.supplier_id !== undefined || input.destination_location_id !== undefined) {
          validatePermission(
            userRole,
            existingOrder.status,
            "edit_header"
          );
        }

        // 2.2. Validate item changes using permission matrix
        if (input.items && input.items.length > 0) {
          validatePermission(
            userRole,
            existingOrder.status,
            "edit_items"
          );
        }
      }

      // Track changes for audit log
      const changes: Array<{
        fieldChanged: string;
        oldValue: string;
        newValue: string;
      }> = [];

      // Hoisted from its original spot in section 6 — the receiving branch
      // below needs it before that point now runs.
      const finalDestinationLocationId =
        input.destination_location_id !== undefined
          ? input.destination_location_id
          : existingOrder.destination_location_id;

      // 3. Handle status update
      //
      // Receiving is identified by the client's intent (status: "RECEIVED"
      // or an explicit receivedItems list — ReceiveOrderDialog always sends
      // both), not trusted as the literal outcome: the actual resulting
      // status (RECEIVED vs PARTIALLY_RECEIVED) depends on real item
      // coverage across possibly multiple receiving events, computed by
      // receivePurchaseOrder itself. Everything else (approve/reject/
      // cancel/etc) is a direct, client-specified transition as before.
      const isReceivingAction =
        input.status === ORDER_STATUS.received || input.receivedItems !== undefined;

      let stockUpdateSummary: string | null = null;
      let receivedResultStatus: "RECEIVED" | "PARTIALLY_RECEIVED" | null = null;

      if (isReceivingAction) {
        if (!finalDestinationLocationId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "destination_location_id is required to receive a purchase order",
          });
        }

        const receiveResult = await receivePurchaseOrder(
          tx,
          input.purchaseOrderId,
          finalDestinationLocationId,
          ctx.user!.id,
          ctx.tenantId!,
          input.receivedItems,
          input.reason || undefined,
        );
        stockUpdateSummary = receiveResult.summary;
        receivedResultStatus = receiveResult.resultStatus;

        if (receivedResultStatus && receivedResultStatus !== existingOrder.status) {
          validateRoleStatusTransition(
            userRole,
            existingOrder.status,
            receivedResultStatus
          );

          changes.push({
            fieldChanged: "status",
            oldValue: existingOrder.status,
            newValue: receivedResultStatus,
          });
        }
      } else if (input.status && input.status !== existingOrder.status) {
        validateRoleStatusTransition(
          userRole,
          existingOrder.status,
          input.status
        );

        changes.push({
          fieldChanged: "status",
          oldValue: existingOrder.status,
          newValue: input.status,
        });
      }

      // 4. Handle supplier_id update
      if (
        input.supplier_id !== undefined &&
        input.supplier_id !== existingOrder.supplier_id
      ) {
        changes.push({
          fieldChanged: "supplier_id",
          oldValue: existingOrder.supplier_id || "null",
          newValue: input.supplier_id,
        });
      }

      // 4.5. Handle destination_location_id update
      if (
        input.destination_location_id !== undefined &&
        input.destination_location_id !== existingOrder.destination_location_id
      ) {
        changes.push({
          fieldChanged: "destination_location_id",
          oldValue: existingOrder.destination_location_id || "null",
          newValue: input.destination_location_id,
        });
      }

      // 5. Handle items update
      if (input.items && input.items.length > 0) {
        // Reject duplicate product_ids within the input, matching
        // createPurchaseOrderWithItems.
        const productIds = input.items.map((item) => item.product_id);
        if (new Set(productIds).size !== productIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Duplicate products in the item list. Each product can only appear once.",
          });
        }

        // Validate all products exist
        for (const item of input.items) {
          const product = await tx.query.Product.findFirst({
            where: and(eq(Product.id, item.product_id), eq(Product.tenant_id, ctx.tenantId!)),
          });

          if (!product) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Product with id ${item.product_id} not found`,
            });
          }
        }

        // Soft-delete existing items (preserves received_qty/audit-referenceable
        // history instead of destroying it, and respects the deletedAt column
        // that every other soft-deletable table in this app uses).
        await tx
          .update(PurchaseOrderItem)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(PurchaseOrderItem.purchase_order_id, input.purchaseOrderId),
              isNull(PurchaseOrderItem.deletedAt),
            ),
          );

        // Insert new items. This path's input never accepts a `unit`, so the
        // qty is always base-unit-equivalent — factor 1.
        await tx.insert(PurchaseOrderItem).values(
          input.items.map((item) => ({
            purchase_order_id: input.purchaseOrderId,
            product_id: item.product_id,
            qty: item.qty,
            unit_price: item.unit_price,
            unit_conversion_factor: 1,
          })),
        );

        changes.push({
          fieldChanged: "items",
          oldValue: JSON.stringify(existingOrder.purchaseOrderItems),
          newValue: JSON.stringify(input.items),
        });
      }

      // 6. Update the purchase order
      // finalDestinationLocationId was hoisted above section 3. Status: a
      // receiving action uses the computed result (or stays unchanged if
      // nothing was actually received), everything else uses the client's
      // requested status as before.
      const finalStatus = isReceivingAction
        ? (receivedResultStatus ?? existingOrder.status)
        : (input.status !== undefined ? input.status : existingOrder.status);
      const finalSupplierId =
        input.supplier_id !== undefined ? input.supplier_id : existingOrder.supplier_id;

      await tx
        .update(PurchaseOrder)
        .set({
          status: finalStatus,
          destination_location_id: finalDestinationLocationId,
          supplier_id: finalSupplierId,
        })
        .where(and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId!)));

      // 7. Log all changes to audit table
      // Always log status changes for audit trail
      // Log other changes for non-draft orders by USER, or for ADMIN on unlocked POs
      const hasStatusChange = changes.some(c => c.fieldChanged === "status");
      const shouldLog = changes.length > 0 && (
        hasStatusChange || // Always log status changes
        (existingOrder.status !== ORDER_STATUS.draft && isLocationScoped(ctx.user!.role)) || // Log location-scoped user changes on non-draft
        isUnlockedEdit // Log ADMIN changes on unlocked POs
      );

      if (shouldLog) {
        await tx.insert(PurchaseOrderAudit).values(
          changes.map((change) => ({
            purchaseOrderId: input.purchaseOrderId,
            userId: ctx.user!.id,
            fieldChanged: change.fieldChanged,
            oldValue: change.oldValue,
            newValue: change.newValue,
            reason: input.reason,
          })),
        );
      }

      return {
        message: "Purchase order updated successfully",
        purchaseOrderId: input.purchaseOrderId,
        status: finalStatus,
        changesLogged: changes.length,
        stockUpdateSummary,
      };
    });
  });
