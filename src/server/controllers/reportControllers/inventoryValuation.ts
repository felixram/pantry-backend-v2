import z from "zod";
import { strictAdminProcedure } from "../../trpc.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { Product } from "../../../db/schema/product.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { Location } from "../../../db/schema/location.ts";
import { Category } from "../../../db/schema/category.ts";
import { eq, sql, and, isNull } from "drizzle-orm";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { TRPCError } from "@trpc/server";
import { getBaseUnitCost, findBaseUnit, findUnit } from "../../../utils/unitConversion.ts";

export const inventoryValuation = strictAdminProcedure
  .input(
    z.object({
      location_id: z.string().optional(),
      category_id: z.string().optional(),
      sortByPercentage: z.enum(["asc", "desc"]).optional(),
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

    // Build conditions - always filter by tenant, exclude archived
    const conditions = [eq(Stock.tenant_id, ctx.tenantId), isNull(Stock.deletedAt)];
    if (locationFilter) {
      conditions.push(eq(Stock.location_id, locationFilter));
    }

    // Fetch stocks with all needed relations (including unit conversions for cost normalization)
    const allStocks = await ctx.db.query.Stock.findMany({
      where: and(...conditions),
      with: {
        product: {
          with: {
            version: true,
            category: true,
            unitConversions: true,
          },
        },
        location: true,
      },
    });

    // Exclude stocks whose location or product has been soft-deleted —
    // neither relation carries a deletedAt filter in the `with` clause
    // above (unlike lowStockReport, which already excludes deleted
    // locations), so an archived location/product would otherwise still
    // inflate the total and appear in the by_location/by_product breakdown.
    const activeStocks = allStocks.filter((stock) => !stock.location?.deletedAt && !stock.product?.deletedAt);

    // Filter by category if provided
    const stocks = input.category_id
      ? activeStocks.filter((stock) => stock.product?.category?.id === input.category_id)
      : activeStocks;

    // Calculate aggregates in application (necessary because of cost price calculation)
    let totalValue = 0;
    const byLocation: Record<string, { location_id: string; location_name: string; item_count: number; total_value: number }> = {};
    const byCategory: Record<string, { category_id: string; category_name: string; item_count: number; total_value: number }> = {};
    const byProduct: Record<string, { product_id: string; product_name: string; qty: number; cost_price: number; total_value: number; item_count: number; unit_name: string | null; display_factor: number }> = {};

    for (const stock of stocks) {
      const product = stock.product;
      const rawCostPrice = product?.version?.costPrice || 0;
      const costPriceUnit = product?.version?.costPriceUnit;

      // Normalize cost price to per-base-unit.
      // costPrice is stored per costPriceUnit (e.g. $54 per Case).
      // Stock qty is in base units. We need cost per base unit.
      const costPerBaseUnit =
        costPriceUnit && product?.unitConversions
          ? getBaseUnitCost(rawCostPrice, product.unitConversions, costPriceUnit)
          : rawCostPrice;

      const itemValue = stock.qty * costPerBaseUnit;

      totalValue += itemValue;

      // Group by location
      const locationKey = stock.location?.id || "unknown";
      if (!byLocation[locationKey]) {
        byLocation[locationKey] = {
          location_id: locationKey,
          location_name: stock.location?.name || "Unknown",
          item_count: 0,
          total_value: 0,
        };
      }
      byLocation[locationKey].item_count++;
      byLocation[locationKey].total_value += itemValue;

      // Group by category
      const categoryKey = product?.category?.id || "unknown";
      if (!byCategory[categoryKey]) {
        byCategory[categoryKey] = {
          category_id: categoryKey,
          category_name: product?.category?.name || "Uncategorized",
          item_count: 0,
          total_value: 0,
        };
      }
      byCategory[categoryKey].item_count++;
      byCategory[categoryKey].total_value += itemValue;

      // Group by product
      const productKey = product?.id || "unknown";
      if (!byProduct[productKey]) {
        // Determine display unit: use stock's display_unit or fall back to base unit
        const conversions = product?.unitConversions;
        const explicit = stock.display_unit && conversions
          ? findUnit(conversions, stock.display_unit)
          : undefined;
        const fallback = conversions ? findBaseUnit(conversions) : undefined;
        const display = explicit && explicit.conversion_factor > 0 ? explicit : fallback;
        const unitName = display?.unit_name ?? null;
        const displayFactor = display?.conversion_factor ?? 1;

        byProduct[productKey] = {
          product_id: productKey,
          product_name: product?.name || "Unknown",
          qty: 0,
          cost_price: costPerBaseUnit,
          total_value: 0,
          item_count: 0,
          unit_name: unitName,
          display_factor: displayFactor,
        };
      }
      byProduct[productKey].qty += stock.qty;
      byProduct[productKey].total_value += itemValue;
      byProduct[productKey].item_count++;
    }

    // Calculate percentages and prepare arrays
    const locationArray = Object.values(byLocation).map((item) => ({
      ...item,
      percentage: totalValue > 0 ? (item.total_value / totalValue) * 100 : 0,
    }));

    const categoryArray = Object.values(byCategory).map((item) => ({
      ...item,
      percentage: totalValue > 0 ? (item.total_value / totalValue) * 100 : 0,
    }));

    const productArray = Object.values(byProduct).map(({ display_factor, ...item }) => ({
      ...item,
      qty: parseFloat((item.qty / display_factor).toFixed(2)),
      percentage: totalValue > 0 ? (item.total_value / totalValue) * 100 : 0,
    }));

    // Sort by percentage if requested
    const sortFn = (input.sortByPercentage === "asc")
      ? (a: { percentage: number }, b: { percentage: number }) => a.percentage - b.percentage
      : (a: { percentage: number }, b: { percentage: number }) => b.percentage - a.percentage;

    locationArray.sort(sortFn);
    categoryArray.sort(sortFn);
    productArray.sort(sortFn);

    return {
      total_items: stocks.length,
      total_value: totalValue,
      by_location: locationArray,
      by_category: categoryArray,
      by_product: productArray,
    };
  });
