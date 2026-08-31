import z from "zod";
import { strictAdminProcedure } from "../../trpc.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { eq, and, gte, lte, isNull, or, sql, count } from "drizzle-orm";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { calculateSubtotal } from "../../../utils/poTotals.ts";
import { roundToCent } from "../../../utils/money.ts";
import { getTenantDefaultCurrency } from "../../../utils/resolveCurrency.ts";
import { normalizeCurrency } from "../../../types/currency.ts";
import { TRPCError } from "@trpc/server";

export const purchaseOrderSummary = strictAdminProcedure
  .input(
    z.object({
      status: z.string().optional(),
      supplier_id: z.string().optional(),
      currency: z.string().optional(), // defaults to the tenant's default currency
      location_id: z.string().optional(), // Optional filter for admins, enforced for regular users
      date_from: z.string().datetime().optional(),
      date_to: z.string().datetime().optional(),
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

    // Apply location-based access control
    const locationFilter = getLocationFilter(
      ctx.user!,
      ctx.userLocationId,
      input.location_id
    );

    // Always filter by tenant
    const conditions = [eq(PurchaseOrder.tenant_id, ctx.tenantId)];

    if (input.status) {
      conditions.push(eq(PurchaseOrder.status, input.status));
    }

    if (input.supplier_id) {
      conditions.push(eq(PurchaseOrder.supplier_id, input.supplier_id));
    }

    // Enforce location filter (user's location or requested location)
    if (locationFilter) {
      conditions.push(eq(PurchaseOrder.destination_location_id, locationFilter));
    }

    if (input.date_from) {
      conditions.push(gte(PurchaseOrder.createdAt, new Date(input.date_from)));
    }

    if (input.date_to) {
      conditions.push(lte(PurchaseOrder.createdAt, new Date(input.date_to)));
    }

    // Currency: money is never summed across currencies. Default to the
    // tenant's default currency; NULL on legacy rows counts as that default.
    const tenantDefaultCurrency = await getTenantDefaultCurrency(ctx.tenantId);
    const selectedCurrency =
      normalizeCurrency(input.currency) ?? tenantDefaultCurrency;

    // Distinct currencies present across the (non-currency) filter scope,
    // plus how many orders the currency filter is about to exclude.
    const currencyBreakdown = await ctx.db
      .select({
        currency: PurchaseOrder.currency,
        n: count(PurchaseOrder.id),
      })
      .from(PurchaseOrder)
      .where(and(...conditions))
      .groupBy(PurchaseOrder.currency);

    const availableCurrencies = [
      ...new Set(currencyBreakdown.map((r) => r.currency || tenantDefaultCurrency)),
    ].sort();
    const excludedCount = currencyBreakdown
      .filter((r) => (r.currency || tenantDefaultCurrency) !== selectedCurrency)
      .reduce((sum, r) => sum + Number(r.n), 0);

    const currencyCondition =
      selectedCurrency === tenantDefaultCurrency
        ? or(eq(PurchaseOrder.currency, selectedCurrency), isNull(PurchaseOrder.currency))!
        : eq(PurchaseOrder.currency, selectedCurrency);
    conditions.push(currencyCondition);

    const orders = await ctx.db.query.PurchaseOrder.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        supplier: true,
        purchaseOrderItems: {
          where: isNull(PurchaseOrderItem.deletedAt),
        },
      },
      limit: input.limit,
      offset: input.offset,
    });

    // Calculate totals
    const byStatus: Record<string, number> = {};
    const bySupplier: Record<string, { supplier_name: string; status: string; order_count: number; total_value: number }> = {};
    let totalValue = 0;

    for (const order of orders) {
      // Count by status
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;

      // Calculate order value
      const orderValue = calculateSubtotal(order.purchaseOrderItems);
      totalValue += orderValue;

      // Group by supplier AND status
      const supplierKey = `${order.supplier?.id || "unknown"}_${order.status}`;
      if (!bySupplier[supplierKey]) {
        bySupplier[supplierKey] = {
          supplier_name: order.supplier?.name || "Unknown",
          status: order.status,
          order_count: 0,
          total_value: 0,
        };
      }
      bySupplier[supplierKey].order_count++;
      bySupplier[supplierKey].total_value += orderValue;
    }

    return {
      total_orders: orders.length,
      by_status: byStatus,
      by_supplier: Object.values(bySupplier).map((s) => ({
        ...s,
        total_value: roundToCent(s.total_value),
      })),
      total_value: roundToCent(totalValue),
      currency: selectedCurrency,
      available_currencies: availableCurrencies,
      excluded_count: excludedCount,
      pagination: {
        limit: input.limit,
        offset: input.offset,
      },
    };
  });
