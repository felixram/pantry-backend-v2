import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import type { userRoles } from "../../../types/user.ts";
import { and, eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import {
  validatePermission,
  isTerminalStatusForRole,
} from "./helpers/permissionMatrix.ts";

export const deletePurchaseOrder = authedMutation
  .input(
    z.object({
      purchaseOrderId: z.uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Fetch the order to check its current status
    const order = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId)),
    });

    if (!order) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Purchase order not found",
      });
    }

    // Validate location access for location-scoped users
    if (order.destination_location_id) {
      validateLocationAccess(ctx.user!, ctx.userLocationId, order.destination_location_id);
    }

    // Check if order is in a terminal state for this role
    const userRole = ctx.user!.role as userRoles;
    if (isTerminalStatusForRole(order.status, userRole)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot delete purchase order in ${order.status} state`,
      });
    }

    // Validate permission to delete using permission matrix
    validatePermission(
      userRole,
      order.status,
      "delete"
    );

    // Soft delete the order
    await ctx.db
      .update(PurchaseOrder)
      .set({ deletedAt: new Date(Date.now()) })
      .where(and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId)));

    return { message: "Order deleted successfully" };
  });
