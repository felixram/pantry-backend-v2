import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { Product } from "../../../db/schema/product.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { InventoryCountSession } from "../../../db/schema/inventoryCountSession.ts";
import { generatePONumber } from "../../../utils/generatePONumber.ts";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { hasElevatedRole } from "../../../types/user.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";

export const createSuggestedPOs = authedMutation
  .input(
    z.object({
      session_id: z.string().uuid(),
      location_id: z.string().uuid(),
      orders: z
        .array(
          z.object({
            supplier_id: z.string().uuid(),
            items: z
              .array(
                z.object({
                  product_id: z.string().uuid(),
                  qty: z.number().positive(),
                  unit_price: z.number().nonnegative(),
                  unit: z.string().optional(),
                })
              )
              .min(1, "At least one item is required per order"),
          })
        )
        .min(1, "At least one order is required"),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    validateLocationAccess(ctx.user!, ctx.userLocationId, input.location_id);

    const initialStatus = hasElevatedRole(ctx.user!.role)
      ? ORDER_STATUS.approved
      : ORDER_STATUS.draft;

    const createdOrders = await ctx.db.transaction(async (tx) => {
      const results: Array<{ purchaseOrderId: string; poNumber: string; supplierId: string }> = [];

      for (const order of input.orders) {
        // Validate all products exist
        for (const item of order.items) {
          const product = await tx.query.Product.findFirst({
            where: and(eq(Product.id, item.product_id), eq(Product.tenant_id, ctx.tenantId!)),
          });
          if (!product) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Product with ID ${item.product_id} not found.`,
            });
          }
        }

        const poNumber = await generatePONumber(ctx.tenantId!);

        const [newPO] = await tx
          .insert(PurchaseOrder)
          .values({
            po_number: poNumber,
            supplier_id: order.supplier_id,
            destination_location_id: input.location_id,
            status: initialStatus,
            tenant_id: ctx.tenantId!,
          })
          .returning();

        if (!newPO) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create purchase order.",
          });
        }

        await tx.insert(PurchaseOrderItem).values(
          order.items.map((item) => ({
            purchase_order_id: newPO.id,
            product_id: item.product_id,
            qty: item.qty,
            unit_price: item.unit_price,
            unit: item.unit,
          }))
        );

        // Update defaultUnit for each product
        for (const item of order.items) {
          if (item.unit) {
            await tx
              .update(Product)
              .set({ defaultUnit: item.unit })
              .where(eq(Product.id, item.product_id));
          }
        }

        results.push({
          purchaseOrderId: newPO.id,
          poNumber,
          supplierId: order.supplier_id,
        });
      }

      // Mark session so suggested POs can't be created again — tenant-scoped,
      // matching the check getSuggestedPOs.ts already does before reading
      // this same session (this write path was missing it).
      await tx
        .update(InventoryCountSession)
        .set({ suggested_pos_created_at: new Date() })
        .where(and(eq(InventoryCountSession.id, input.session_id), eq(InventoryCountSession.tenant_id, ctx.tenantId!)));

      return results;
    });

    return {
      message: `${createdOrders.length} purchase order(s) created successfully.`,
      orders: createdOrders,
    };
  });
