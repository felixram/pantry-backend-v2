import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
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
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Check for existing PO with same supplier + location
    // Only consider non-terminal states (DRAFT, PENDING_APPROVAL, APPROVED)
    // Exclude soft-deleted POs
    const existingPO = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(
        eq(PurchaseOrder.tenant_id, ctx.tenantId),
        eq(PurchaseOrder.supplier_id, input.supplier_id),
        eq(PurchaseOrder.destination_location_id, input.destination_location_id),
        ne(PurchaseOrder.status, ORDER_STATUS.cancelled),
        ne(PurchaseOrder.status, ORDER_STATUS.rejected),
        ne(PurchaseOrder.status, ORDER_STATUS.ordered),
        ne(PurchaseOrder.status, ORDER_STATUS.partiallyReceived),
        ne(PurchaseOrder.status, ORDER_STATUS.received),
        isNull(PurchaseOrder.deletedAt),
      ),
      with: {
        purchaseOrderItems: {
          where: isNull(PurchaseOrderItem.deletedAt),
        },
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
