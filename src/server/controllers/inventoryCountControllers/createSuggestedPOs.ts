import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Product } from "../../../db/schema/product.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { InventoryCountSession } from "../../../db/schema/inventoryCountSession.ts";
import { generatePONumber } from "../../../utils/generatePONumber.ts";
import { getTenantDefaultCurrency } from "../../../utils/resolveCurrency.ts";
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

    const { results, skippedSupplierIds } = await ctx.db.transaction(async (tx) => {
      // Idempotency check: which of the requested suppliers already have a
      // PO from this exact count session? Checked and acted on inside this
      // same transaction (not a separate read endpoint) so two concurrent
      // submissions — a double-click, two tabs, a stale-page resubmit —
      // can't both slip past a check-then-write race and each create a full
      // duplicate set of orders.
      const requestedSupplierIds = input.orders.map((o) => o.supplier_id);
      const existingPOs = await tx.query.PurchaseOrder.findMany({
        where: and(
          eq(PurchaseOrder.source_count_session_id, input.session_id),
          eq(PurchaseOrder.tenant_id, ctx.tenantId!),
          inArray(PurchaseOrder.supplier_id, requestedSupplierIds),
          isNull(PurchaseOrder.deletedAt),
        ),
        columns: { supplier_id: true },
      });
      const alreadyOrderedSupplierIds = new Set(
        existingPOs.map((po) => po.supplier_id).filter((id): id is string => id !== null),
      );

      const results: Array<{ purchaseOrderId: string; poNumber: string; supplierId: string }> = [];
      const skippedSupplierIds: string[] = [];
      const tenantDefaultCurrency = await getTenantDefaultCurrency(ctx.tenantId!);

      for (const order of input.orders) {
        if (alreadyOrderedSupplierIds.has(order.supplier_id)) {
          skippedSupplierIds.push(order.supplier_id);
          continue;
        }

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

        const supplier = await tx.query.Supplier.findFirst({
          where: and(eq(Supplier.id, order.supplier_id), eq(Supplier.tenant_id, ctx.tenantId!)),
          columns: { currency: true },
        });

        const [newPO] = await tx
          .insert(PurchaseOrder)
          .values({
            po_number: poNumber,
            supplier_id: order.supplier_id,
            destination_location_id: input.location_id,
            status: initialStatus,
            currency: supplier?.currency || tenantDefaultCurrency,
            tenant_id: ctx.tenantId!,
            source_count_session_id: input.session_id,
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

      // Stamped on first touch, kept for display/audit purposes only — no
      // longer what enforces anything (that's the per-supplier check above).
      if (results.length > 0) {
        await tx
          .update(InventoryCountSession)
          .set({ suggested_pos_created_at: new Date() })
          .where(and(eq(InventoryCountSession.id, input.session_id), eq(InventoryCountSession.tenant_id, ctx.tenantId!)));
      }

      return { results, skippedSupplierIds };
    });

    const messageParts = [`${results.length} purchase order(s) created successfully.`];
    if (skippedSupplierIds.length > 0) {
      messageParts.push(
        `${skippedSupplierIds.length} supplier(s) already had an order from this count and were skipped.`,
      );
    }

    return {
      message: messageParts.join(" "),
      orders: results,
      skippedSupplierIds,
    };
  });
