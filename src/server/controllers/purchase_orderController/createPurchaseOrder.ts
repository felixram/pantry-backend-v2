import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { generatePONumber } from "../../../utils/generatePONumber.ts";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { hasElevatedRole } from "../../../types/user.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";

export const createPurchaseOrder = authedMutation
  .input(
    z.object({
      product_id: z.uuid(),
      qty: z.number().nonnegative().default(1),
      unit_price: z.number().default(0.0),
      supplier_id: z.uuid(),
      destination_location_id: z.uuid(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Validate user has access to the destination location
    validateLocationAccess(
      ctx.user!,
      ctx.userLocationId,
      input.destination_location_id
    );

    const purchaseOrderId = await ctx.db.transaction(async (tx) => {
      // Validate product exists
      const product = await tx.query.Product.findFirst({
        where: eq(Product.id, input.product_id),
      });

      if (!product)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Product Not Found.",
        });

      // Generate PO number
      const poNumber = await generatePONumber(ctx.tenantId!);

      // Elevated roles (ADMIN, MANAGER) start POs in APPROVED status (they don't need self-approval)
      // Regular users start in DRAFT status
      const initialStatus =
        hasElevatedRole(ctx.user!.role)
          ? ORDER_STATUS.approved
          : ORDER_STATUS.draft;

      // Always create new PO (no consolidation)
      const [newPurchaseOrder] = await tx
        .insert(PurchaseOrder)
        .values({
          po_number: poNumber,
          supplier_id: input.supplier_id,
          destination_location_id: input.destination_location_id,
          status: initialStatus,
          tenant_id: ctx.tenantId!,
        })
        .returning();

      if (!newPurchaseOrder) {
        throw new TRPCError({
          message: "An error has occurred when creating an order",
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      // Add the item to the new PO
      await tx.insert(PurchaseOrderItem).values({
        purchase_order_id: newPurchaseOrder.id,
        qty: input.qty,
        unit_price: input.unit_price,
        product_id: input.product_id,
      });

      return newPurchaseOrder.id;
    });

    return { message: "Order created.", purchaseOrderId };
  });
