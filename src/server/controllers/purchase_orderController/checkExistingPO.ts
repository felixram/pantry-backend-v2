import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { and, eq, ne, isNull } from "drizzle-orm";
import { ORDER_STATUS } from "../../../types/orders.ts";

export const checkExistingPO = authedProcedure
  .input(
    z.object({
      supplier_id: z.uuid(),
      destination_location_id: z.uuid(),
    })
  )
  .query(async ({ ctx, input }) => {
    // Check for existing PO with same supplier + location
    // Only consider non-terminal states (DRAFT, PENDING_APPROVAL, APPROVED)
    // Exclude soft-deleted POs
    const existingPO = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(
        eq(PurchaseOrder.supplier_id, input.supplier_id),
        eq(PurchaseOrder.destination_location_id, input.destination_location_id),
        ne(PurchaseOrder.status, ORDER_STATUS.cancelled),
        ne(PurchaseOrder.status, ORDER_STATUS.rejected),
        ne(PurchaseOrder.status, ORDER_STATUS.ordered),
        ne(PurchaseOrder.status, ORDER_STATUS.received),
        isNull(PurchaseOrder.deletedAt),
      ),
      with: {
        purchaseOrderItems: true,
      },
    });

    if (existingPO) {
      return {
        exists: true,
        po: {
          id: existingPO.id,
          po_number: existingPO.po_number,
          status: existingPO.status,
          itemCount: existingPO.purchaseOrderItems?.length || 0,
        },
      };
    }

    return {
      exists: false,
      po: null,
    };
  });
