import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { Product } from "../../../db/schema/product.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { Category } from "../../../db/schema/category.ts";
import { Location } from "../../../db/schema/location.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts";
import {
  eq,
  and,
  isNull,
  isNotNull,
  gte,
  lt,
  lte,
  gt,
  sql,
  sum,
  count,
  countDistinct,
  desc,
  asc,
  inArray,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getTenantDefaultCurrency } from "../../../utils/resolveCurrency.ts";
import { ROLES } from "../../../types/user.ts";
import { getLocationFilter } from "../../../utils/locationFilter.ts";

// Helper to calculate growth percentage from current/previous month counts
function calculateGrowthFromCounts(
  currentCount: number,
  previousCount: number
): number {
  if (previousCount === 0) {
    return currentCount > 0 ? 100 : 0;
  }
  return Math.round(((currentCount - previousCount) / previousCount) * 100);
}

// Helper to determine stock status
function getStockStatus(
  currentQty: number,
  minimumLevel: number | null
): "in_stock" | "low_stock" | "critical" | "out_of_stock" {
  if (currentQty === 0) return "out_of_stock";
  if (currentQty <= 3) return "critical";
  if (minimumLevel !== null && currentQty <= minimumLevel) return "low_stock";
  return "in_stock";
}

export const dashboardData = authedProcedure
  .input(
    z.object({
      includeValuation: z.boolean().optional(),
      location_id: z.string().uuid().optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Stock value is Reports-level data (see strictAdminProcedure) — MANAGER
    // must not receive it in the response at all, not just have it hidden by
    // the frontend, since the raw payload is inspectable via devtools.
    const isStrictAdmin = ctx.user!.role === ROLES.admin;
    const includeValuation = input.includeValuation && isStrictAdmin;

    // Location-based access control: managers only see their location's data
    const locationFilter = getLocationFilter(ctx.user!, ctx.userLocationId, input.location_id);
    const stockLocationCond = locationFilter ? eq(Stock.location_id, locationFilter) : undefined;
    const poLocationCond = locationFilter ? eq(PurchaseOrder.destination_location_id, locationFilter) : undefined;

    // Date boundaries for growth calculations
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Common tenant + not-deleted filters
    const productBase = and(eq(Product.tenant_id, ctx.tenantId), isNull(Product.deletedAt));
    const supplierBase = and(eq(Supplier.tenant_id, ctx.tenantId), isNull(Supplier.deletedAt));
    const orderBase = and(eq(PurchaseOrder.tenant_id, ctx.tenantId), isNull(PurchaseOrder.deletedAt), poLocationCond);

    // Product/Supplier are tenant-wide (no location_id column), so "total items"/
    // "active suppliers" can only be scoped to a location by inferring presence
    // through a related table — Stock for products, PurchaseOrder for suppliers.
    // The unfiltered "All Locations" case keeps today's plain catalog/directory
    // counts unchanged; only a specific location selection switches query shape.
    const stockBaseCond = and(eq(Stock.tenant_id, ctx.tenantId), isNull(Location.deletedAt), isNull(Stock.deletedAt), stockLocationCond);

    const productTotalQuery = locationFilter
      ? ctx.db.select({ value: countDistinct(Stock.productId) }).from(Stock).innerJoin(Location, eq(Stock.location_id, Location.id)).where(stockBaseCond)
      : ctx.db.select({ value: count() }).from(Product).where(productBase);
    const productCurrentQuery = locationFilter
      ? ctx.db.select({ value: countDistinct(Stock.productId) }).from(Stock).innerJoin(Location, eq(Stock.location_id, Location.id)).where(and(stockBaseCond, gte(Stock.createdAt, currentMonthStart)))
      : ctx.db.select({ value: count() }).from(Product).where(and(productBase, gte(Product.createdAt, currentMonthStart)));
    const productPreviousQuery = locationFilter
      ? ctx.db.select({ value: countDistinct(Stock.productId) }).from(Stock).innerJoin(Location, eq(Stock.location_id, Location.id)).where(and(stockBaseCond, gte(Stock.createdAt, previousMonthStart), lt(Stock.createdAt, currentMonthStart)))
      : ctx.db.select({ value: count() }).from(Product).where(and(productBase, gte(Product.createdAt, previousMonthStart), lt(Product.createdAt, currentMonthStart)));

    const supplierTotalQuery = locationFilter
      ? ctx.db.select({ value: countDistinct(PurchaseOrder.supplier_id) }).from(PurchaseOrder).where(orderBase)
      : ctx.db.select({ value: count() }).from(Supplier).where(supplierBase);
    const supplierCurrentQuery = locationFilter
      ? ctx.db.select({ value: countDistinct(PurchaseOrder.supplier_id) }).from(PurchaseOrder).where(and(orderBase, gte(PurchaseOrder.createdAt, currentMonthStart)))
      : ctx.db.select({ value: count() }).from(Supplier).where(and(supplierBase, gte(Supplier.createdAt, currentMonthStart)));
    const supplierPreviousQuery = locationFilter
      ? ctx.db.select({ value: countDistinct(PurchaseOrder.supplier_id) }).from(PurchaseOrder).where(and(orderBase, gte(PurchaseOrder.createdAt, previousMonthStart), lt(PurchaseOrder.createdAt, currentMonthStart)))
      : ctx.db.select({ value: count() }).from(Supplier).where(and(supplierBase, gte(Supplier.createdAt, previousMonthStart), lt(Supplier.createdAt, currentMonthStart)));

    // Run all optimized queries in parallel
    const [
      productTotal,
      productCurrent,
      productPrevious,
      supplierTotal,
      supplierCurrent,
      supplierPrevious,
      orderTotal,
      orderCurrent,
      orderPrevious,
      monthlyOrders,
      categoryDistribution,
      topItemsRaw,
      criticalAlerts,
      warningAlerts,
      valuationResult,
    ] = await Promise.all([
      // 1. Product KPI: total + growth — location-scoped via Stock when a location is selected
      productTotalQuery,
      productCurrentQuery,
      productPreviousQuery,

      // 2. Supplier KPI: total + growth — location-scoped via PurchaseOrder when a location is selected
      supplierTotalQuery,
      supplierCurrentQuery,
      supplierPreviousQuery,

      // 3. Order KPI: total + growth
      ctx.db.select({ value: count() }).from(PurchaseOrder).where(orderBase),
      ctx.db.select({ value: count() }).from(PurchaseOrder).where(and(orderBase, gte(PurchaseOrder.createdAt, currentMonthStart))),
      ctx.db.select({ value: count() }).from(PurchaseOrder).where(and(orderBase, gte(PurchaseOrder.createdAt, previousMonthStart), lt(PurchaseOrder.createdAt, currentMonthStart))),

      // 4. Monthly orders (last 6 months, SQL GROUP BY)
      ctx.db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${PurchaseOrder.createdAt}), 'Mon YYYY')`.as(
            "month"
          ),
          monthDate: sql<Date>`DATE_TRUNC('month', ${PurchaseOrder.createdAt})`.as(
            "month_date"
          ),
          orders: count().as("orders"),
        })
        .from(PurchaseOrder)
        .where(
          and(
            eq(PurchaseOrder.tenant_id, ctx.tenantId),
            isNull(PurchaseOrder.deletedAt),
            gte(PurchaseOrder.createdAt, sixMonthsAgo),
            poLocationCond
          )
        )
        .groupBy(
          sql`DATE_TRUNC('month', ${PurchaseOrder.createdAt})`
        )
        .orderBy(
          asc(sql`DATE_TRUNC('month', ${PurchaseOrder.createdAt})`)
        ),

      // 5. Category distribution (SQL GROUP BY with JOINs)
      ctx.db
        .select({
          name: sql<string>`COALESCE(${Category.name}, 'Uncategorized')`.as(
            "category_name"
          ),
          value: count().as("count"),
        })
        .from(Stock)
        .innerJoin(Product, eq(Stock.productId, Product.id))
        .innerJoin(Location, eq(Stock.location_id, Location.id))
        .leftJoin(Category, eq(Product.category_id, Category.id))
        .where(
          and(
            eq(Stock.tenant_id, ctx.tenantId),
            isNull(Location.deletedAt),
            isNull(Stock.deletedAt),
            stockLocationCond
          )
        )
        .groupBy(Category.name)
        .orderBy(desc(count())),

      // 6. Top items by order quantity (SQL aggregation, LIMIT 5)
      ctx.db
        .select({
          productId: PurchaseOrderItem.product_id,
          productName: Product.name,
          orderCount: sql<number>`COALESCE(SUM(${PurchaseOrderItem.qty}), 0)`.as(
            "total_qty"
          ),
        })
        .from(PurchaseOrderItem)
        .innerJoin(
          PurchaseOrder,
          eq(PurchaseOrderItem.purchase_order_id, PurchaseOrder.id)
        )
        .innerJoin(Product, eq(PurchaseOrderItem.product_id, Product.id))
        .where(
          and(
            eq(PurchaseOrder.tenant_id, ctx.tenantId),
            isNull(PurchaseOrder.deletedAt),
            poLocationCond
          )
        )
        .groupBy(PurchaseOrderItem.product_id, Product.name)
        .orderBy(desc(sql`COALESCE(SUM(${PurchaseOrderItem.qty}), 0)`))
        .limit(5),

      // 7. Critical alerts: shortage > 50% of minimum level (qty < minimum * 0.5)
      ctx.db
        .select({
          productName: Product.name,
          productId: Stock.productId,
          qty: Stock.qty,
          minimumLevel: Stock.minimumStockLevel,
          display_unit: Stock.display_unit,
        })
        .from(Stock)
        .innerJoin(Product, eq(Stock.productId, Product.id))
        .innerJoin(Location, eq(Stock.location_id, Location.id))
        .where(
          and(
            eq(Stock.tenant_id, ctx.tenantId),
            isNull(Location.deletedAt),
            isNull(Stock.deletedAt),
            stockLocationCond,
            isNotNull(Stock.minimumStockLevel),
            lte(Stock.qty, sql`${Stock.minimumStockLevel}`),
            lt(Stock.qty, sql`${Stock.minimumStockLevel} * 0.5`)
          )
        )
        .orderBy(asc(Stock.qty))
        .limit(5),

      // 8. Warning alerts: below minimum but shortage <= 50% (qty >= minimum * 0.5)
      ctx.db
        .select({
          productName: Product.name,
          productId: Stock.productId,
          qty: Stock.qty,
          minimumLevel: Stock.minimumStockLevel,
          display_unit: Stock.display_unit,
        })
        .from(Stock)
        .innerJoin(Product, eq(Stock.productId, Product.id))
        .innerJoin(Location, eq(Stock.location_id, Location.id))
        .where(
          and(
            eq(Stock.tenant_id, ctx.tenantId),
            isNull(Location.deletedAt),
            isNull(Stock.deletedAt),
            stockLocationCond,
            isNotNull(Stock.minimumStockLevel),
            lte(Stock.qty, sql`${Stock.minimumStockLevel}`),
            gte(Stock.qty, sql`${Stock.minimumStockLevel} * 0.5`)
          )
        )
        .orderBy(asc(Stock.qty))
        .limit(5),

      // 9. Inventory valuation (only for elevated users)
      // Normalize cost price to per-base-unit by dividing by the conversion factor
      // of the costPriceUnit. If no costPriceUnit is set, assume cost is per base unit.
      includeValuation
        ? ctx.db
            .select({
              totalValue: sql<number>`COALESCE(SUM(
                ${Stock.qty} * ${ProductVersion.costPrice}
                / COALESCE(${ProductUnitConversion.conversion_factor}, 1)
              ), 0)`.as(
                "total_value"
              ),
            })
            .from(Stock)
            .innerJoin(Product, eq(Stock.productId, Product.id))
            .innerJoin(Location, eq(Stock.location_id, Location.id))
            .leftJoin(
              ProductVersion,
              eq(Product.activeVersionId, ProductVersion.id)
            )
            .leftJoin(
              ProductUnitConversion,
              and(
                eq(ProductUnitConversion.product_id, Product.id),
                eq(ProductUnitConversion.unit_name, sql`${ProductVersion.costPriceUnit}`)
              )
            )
            .where(
              and(
                eq(Stock.tenant_id, ctx.tenantId),
                isNull(Location.deletedAt),
                isNull(Stock.deletedAt),
                stockLocationCond
              )
            )
        : Promise.resolve(null),
    ]);

    // Extract KPI values
    const totalItems = productTotal[0]!.value;
    const activeSuppliers = supplierTotal[0]!.value;
    const totalOrders = orderTotal[0]!.value;

    const totalItemsGrowth = calculateGrowthFromCounts(
      productCurrent[0]!.value,
      productPrevious[0]!.value
    );
    const activeSuppliersGrowth = calculateGrowthFromCounts(
      supplierCurrent[0]!.value,
      supplierPrevious[0]!.value
    );
    const totalOrdersGrowth = calculateGrowthFromCounts(
      orderCurrent[0]!.value,
      orderPrevious[0]!.value
    );

    // Build monthly orders with zero-fill for months without data
    const monthlyOrdersMap = new Map(
      monthlyOrders.map((row) => [row.month, row.orders])
    );
    const monthlyOrdersResult: Array<{ month: string; orders: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = date.toLocaleString("en", {
        month: "short",
        year: "numeric",
      });
      monthlyOrdersResult.push({
        month: monthKey,
        orders: monthlyOrdersMap.get(monthKey) || 0,
      });
    }

    // Build category distribution with top 5 + "Other"
    const stockTotal = categoryDistribution.reduce(
      (sum, row) => sum + row.value,
      0
    );
    let categoryResult: Array<{
      name: string;
      value: number;
      percentage: number;
    }>;

    if (categoryDistribution.length <= 5) {
      categoryResult = categoryDistribution.map((row) => ({
        name: row.name,
        value: row.value,
        percentage:
          stockTotal > 0 ? Math.round((row.value / stockTotal) * 100) : 0,
      }));
    } else {
      const topCategories = categoryDistribution.slice(0, 5).map((row) => ({
        name: row.name,
        value: row.value,
        percentage:
          stockTotal > 0 ? Math.round((row.value / stockTotal) * 100) : 0,
      }));
      const otherValue = categoryDistribution
        .slice(5)
        .reduce((s, row) => s + row.value, 0);
      const otherPercentage =
        stockTotal > 0 ? Math.round((otherValue / stockTotal) * 100) : 0;
      if (otherValue > 0) {
        topCategories.push({
          name: "Other",
          value: otherValue,
          percentage: otherPercentage,
        });
      }
      categoryResult = topCategories;
    }

    // Fetch stock status for the top 5 items
    const topItemProductIds = topItemsRaw.map((item) => item.productId);
    let stockByProduct = new Map<
      string,
      { qty: number; minimumStockLevel: number | null }
    >();

    if (topItemProductIds.length > 0) {
      const stocksForTopItems = await ctx.db
        .select({
          productId: Stock.productId,
          qty: Stock.qty,
          minimumStockLevel: Stock.minimumStockLevel,
        })
        .from(Stock)
        .innerJoin(Location, eq(Stock.location_id, Location.id))
        .where(
          and(
            eq(Stock.tenant_id, ctx.tenantId),
            isNull(Location.deletedAt),
            isNull(Stock.deletedAt),
            stockLocationCond,
            sql`${Stock.productId} IN ${topItemProductIds}`
          )
        );

      stocksForTopItems.forEach((s) => {
        if (s.productId) {
          stockByProduct.set(s.productId, {
            qty: s.qty,
            minimumStockLevel: s.minimumStockLevel,
          });
        }
      });
    }

    const topItems = topItemsRaw.map((item) => {
      const stockInfo = stockByProduct.get(item.productId);
      return {
        productId: item.productId,
        productName: item.productName,
        orderCount: item.orderCount,
        stockStatus: stockInfo
          ? getStockStatus(stockInfo.qty, stockInfo.minimumStockLevel)
          : ("in_stock" as const),
      };
    });

    // Extract valuation if applicable
    let orderValue: number | undefined;
    if (includeValuation && valuationResult) {
      orderValue = (valuationResult as Array<{ totalValue: number }>)[0]
        ?.totalValue ?? 0;
    }

    // The valuation KPI is derived from internal cost prices, so it's
    // inherently in the tenant's own currency — surface which one for
    // display formatting.
    const currency = await getTenantDefaultCurrency(ctx.tenantId);

    // Resolve display units for alert items
    const allAlertItems = [...criticalAlerts, ...warningAlerts];
    const alertProductIds = [...new Set(
      allAlertItems.map((a) => a.productId).filter((id): id is string => id != null)
    )];

    let alertUnitMap = new Map<string, { unitName: string; factor: number }>();
    let alertBaseUnitMap = new Map<string, string>();
    if (alertProductIds.length > 0) {
      const alertConversions = await ctx.db
        .select({
          product_id: ProductUnitConversion.product_id,
          unit_name: ProductUnitConversion.unit_name,
          conversion_factor: ProductUnitConversion.conversion_factor,
          is_base_unit: ProductUnitConversion.is_base_unit,
        })
        .from(ProductUnitConversion)
        .where(inArray(ProductUnitConversion.product_id, alertProductIds));

      for (const uc of alertConversions) {
        if (uc.is_base_unit) {
          alertBaseUnitMap.set(uc.product_id, uc.unit_name);
        }
        alertUnitMap.set(`${uc.product_id}:${uc.unit_name}`, {
          unitName: uc.unit_name,
          factor: uc.conversion_factor,
        });
      }
    }

    const resolveAlertUnit = (item: { productId: string | null; qty: number; display_unit: string | null }) => {
      const pid = item.productId || "";
      const du = item.display_unit;
      if (du) {
        const conv = alertUnitMap.get(`${pid}:${du}`);
        if (conv && conv.factor > 0) {
          return { displayQty: item.qty / conv.factor, unitName: du };
        }
      }
      const baseUnit = alertBaseUnitMap.get(pid);
      return { displayQty: item.qty, unitName: baseUnit || null };
    };

    return {
      currency,
      kpis: {
        totalItems,
        totalItemsGrowth,
        activeSuppliers,
        activeSuppliersGrowth,
        totalOrders,
        totalOrdersGrowth,
        ...(includeValuation && { orderValue }),
      },
      monthlyOrders: monthlyOrdersResult,
      categoryDistribution: categoryResult,
      topItems,
      alerts: {
        critical: criticalAlerts.map((item) => {
          const { displayQty, unitName } = resolveAlertUnit(item);
          return {
            productName: item.productName,
            qty: parseFloat(displayQty.toFixed(2)),
            minimumLevel: item.minimumLevel || 0,
            unitName,
          };
        }),
        warning: warningAlerts.map((item) => {
          const { displayQty, unitName } = resolveAlertUnit(item);
          return {
            productName: item.productName,
            qty: parseFloat(displayQty.toFixed(2)),
            minimumLevel: item.minimumLevel || 0,
            unitName,
          };
        }),
      },
    };
  });
