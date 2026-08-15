import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { eq, and, gte, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { calculateSubtotal } from "../../../utils/poTotals.ts";
import { roundToCent } from "../../../utils/money.ts";

export const supplierPerformance = authedProcedure
  .input(
    z.object({
      supplier_id: z.string().optional(),
      location_id: z.string().optional(),
      period: z.enum(["week", "month", "quarter", "year"]).default("month"),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Calculate date range based on period
    const now = new Date();
    const dateFrom = new Date(now);

    switch (input.period) {
      case "week":
        dateFrom.setDate(now.getDate() - 7);
        break;
      case "month":
        dateFrom.setMonth(now.getMonth() - 1);
        break;
      case "quarter":
        dateFrom.setMonth(now.getMonth() - 3);
        break;
      case "year":
        dateFrom.setFullYear(now.getFullYear() - 1);
        break;
    }

    // Always filter by tenant, exclude soft-deleted orders
    const conditions = [
      eq(PurchaseOrder.tenant_id, ctx.tenantId),
      isNull(PurchaseOrder.deletedAt),
      gte(PurchaseOrder.createdAt, dateFrom),
    ];

    if (input.supplier_id) {
      conditions.push(eq(PurchaseOrder.supplier_id, input.supplier_id));
    }

    // Apply location-based access control
    const locationFilter = getLocationFilter(ctx.user!, ctx.userLocationId, input.location_id);
    if (locationFilter) {
      conditions.push(eq(PurchaseOrder.destination_location_id, locationFilter));
    }

    const orders = await ctx.db.query.PurchaseOrder.findMany({
      where: and(...conditions),
      with: {
        supplier: true,
        purchaseOrderItems: {
          where: isNull(PurchaseOrderItem.deletedAt),
        },
      },
      limit: input.limit,
      offset: input.offset,
    });

    // Group by supplier
    const bySupplier: Record<string, {
      supplier_name: string;
      total_orders: number;
      completed_orders: number;
      cancelled_orders: number;
      total_value: number;
      average_order_value: number;
    }> = {};

    for (const order of orders) {
      const supplierKey = order.supplier?.id || "unknown";

      if (!bySupplier[supplierKey]) {
        bySupplier[supplierKey] = {
          supplier_name: order.supplier?.name || "Unknown",
          total_orders: 0,
          completed_orders: 0,
          cancelled_orders: 0,
          total_value: 0,
          average_order_value: 0,
        };
      }

      const orderValue = calculateSubtotal(order.purchaseOrderItems);

      bySupplier[supplierKey].total_orders++;
      bySupplier[supplierKey].total_value += orderValue;

      if (order.status === ORDER_STATUS.received) {
        bySupplier[supplierKey].completed_orders++;
      }

      if (order.status === ORDER_STATUS.cancelled || order.status === ORDER_STATUS.rejected) {
        bySupplier[supplierKey].cancelled_orders++;
      }
    }

    // Calculate averages
    const performance = Object.values(bySupplier).map((supplier) => ({
      ...supplier,
      total_value: roundToCent(supplier.total_value),
      average_order_value: supplier.total_orders > 0
        ? roundToCent(supplier.total_value / supplier.total_orders)
        : 0,
    }));

    return {
      period: input.period,
      date_from: dateFrom.toISOString(),
      date_to: now.toISOString(),
      suppliers: performance,
      pagination: {
        limit: input.limit,
        offset: input.offset,
      },
    };
  });
