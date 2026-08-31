import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { generatePONumber } from "../../../utils/generatePONumber.ts";
import { getTenantDefaultCurrency } from "../../../utils/resolveCurrency.ts";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { hasElevatedRole } from "../../../types/user.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const createPurchaseOrderWithItems = authedMutation
  .input(
    z.object({
      supplier_id: z.uuid(),
      destination_location_id: z.uuid(),
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
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Validate location access
    validateLocationAccess(
      ctx.user!,
      ctx.userLocationId,
      input.destination_location_id
    );

    const purchaseOrderId = await ctx.db.transaction(async (tx) => {
      // Validate all products exist
      for (const item of input.items) {
        const product = await tx.query.Product.findFirst({
          where: and(
            eq(Product.id, item.product_id),
            eq(Product.tenant_id, ctx.tenantId!)
          ),
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

      // Snapshot the currency this PO is placed in: the supplier's, else
      // the tenant default. Frozen on the row so a later supplier-currency
      // change doesn't retroactively relabel historical orders.
      const supplier = await tx.query.Supplier.findFirst({
        where: and(
          eq(Supplier.id, input.supplier_id),
          eq(Supplier.tenant_id, ctx.tenantId!)
        ),
        columns: { currency: true },
      });
      const currency =
        supplier?.currency || (await getTenantDefaultCurrency(ctx.tenantId!));

      // Generate PO number
      const poNumber = await generatePONumber(ctx.tenantId!);

      // Elevated roles (ADMIN, MANAGER) start POs in APPROVED status (they don't need self-approval)
      // Regular users start in DRAFT status
      const initialStatus =
        hasElevatedRole(ctx.user!.role)
          ? ORDER_STATUS.approved
          : ORDER_STATUS.draft;

      // Create new PO
      const [newPurchaseOrder] = await tx
        .insert(PurchaseOrder)
        .values({
          po_number: poNumber,
          supplier_id: input.supplier_id,
          destination_location_id: input.destination_location_id,
          status: initialStatus,
          currency,
          tenant_id: ctx.tenantId!,
        })
        .returning();

      if (!newPurchaseOrder) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create purchase order.",
        });
      }

      // Add all items in a single transaction, snapshotting each item's
      // conversion factor so receiving later uses order-time intent.
      const itemsWithFactor = await Promise.all(
        input.items.map(async (item) => {
          const { factor } = await resolveUnitFactor(
            tx,
            item.product_id,
            ctx.tenantId!,
            item.unit
          );
          return {
            purchase_order_id: newPurchaseOrder.id,
            product_id: item.product_id,
            qty: item.qty,
            unit_price: item.unit_price,
            unit: item.unit,
            unit_conversion_factor: factor,
          };
        })
      );

      await tx.insert(PurchaseOrderItem).values(itemsWithFactor);

      // Update defaultUnit for each product (last used unit becomes default)
      for (const item of input.items) {
        if (item.unit) {
          await tx
            .update(Product)
            .set({ defaultUnit: item.unit })
            .where(eq(Product.id, item.product_id));
        }
      }

      return newPurchaseOrder.id;
    });

    return { message: "Purchase order created with all items.", purchaseOrderId };
  });
