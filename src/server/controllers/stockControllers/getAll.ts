import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { Product } from "../../../db/schema/product.ts";
import { Location } from "../../../db/schema/location.ts";
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts";
import { eq, and, lte, sql, ilike, isNull, isNotNull, or, desc, inArray } from "drizzle-orm";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { TRPCError } from "@trpc/server";

export const getAllStock = authedProcedure
  .input(
    z.object({
      product_id: z.string().optional(),
      location_id: z.string().optional(),
      // "none" matches the productControllers convention: products with no supplier.
      supplier_id: z.union([z.string().uuid(), z.literal("none")]).optional(),
      lowStock: z.boolean().optional(),
      search: z.string().optional(),
      status: z.enum(["OK", "LOW", "OUT_OF_STOCK"]).optional(),
      archived: z.boolean().optional(),
      limit: z.number().optional().default(10),
      offset: z.number().optional().default(0),
      mode: z.enum(["list", "full"]).optional().default("full"),
    }),
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

    // Build where conditions - always filter by tenant
    // Show archived items when explicitly requested, otherwise exclude them
    const conditions = [
      eq(Stock.tenant_id, ctx.tenantId),
      input.archived ? isNotNull(Stock.deletedAt) : isNull(Stock.deletedAt),
    ];

    if (input.product_id) {
      conditions.push(eq(Stock.productId, input.product_id));
    }

    // Enforce location filter (user's location or requested location for admin)
    if (locationFilter) {
      conditions.push(eq(Stock.location_id, locationFilter));
    }

    if (input.lowStock) {
      // Filter where qty <= minimumStockLevel
      conditions.push(lte(Stock.qty, sql`${Stock.minimumStockLevel}`));
    }

    // Supplier filter requires a Product join. List mode already joins Product;
    // full mode applies this predicate after the fetch (see below).
    const supplierPredicate =
      input.supplier_id === "none"
        ? isNull(Product.supplier_id)
        : input.supplier_id
          ? eq(Product.supplier_id, input.supplier_id)
          : undefined;
    if (supplierPredicate && input.mode !== "full") {
      conditions.push(supplierPredicate);
    }

    // List mode: lightweight SQL query with JOINs
    if (input.mode === "list") {
      // Filter out deleted locations in SQL
      conditions.push(isNull(Location.deletedAt));

      // Search via SQL WHERE
      if (input.search) {
        conditions.push(
          or(
            ilike(Product.name, `%${input.search}%`),
            ilike(Product.sku, `%${input.search}%`),
            ilike(Location.name, `%${input.search}%`),
          )!
        );
      }

      // Status filter via SQL CASE WHEN
      const statusExpr = sql`CASE
        WHEN ${Stock.qty} = 0 THEN 'OUT_OF_STOCK'
        WHEN ${Stock.minimumStockLevel} IS NOT NULL AND ${Stock.qty} <= ${Stock.minimumStockLevel} THEN 'LOW'
        ELSE 'OK'
      END`;

      if (input.status) {
        conditions.push(sql`${statusExpr} = ${input.status}`);
      }

      const results = await ctx.db
        .select({
          id: Stock.id,
          productId: Stock.productId,
          location_id: Stock.location_id,
          qty: Stock.qty,
          minimumStockLevel: Stock.minimumStockLevel,
          parLevel: Stock.parLevel,
          display_unit: Stock.display_unit,
          status: sql<string>`${statusExpr}`.as("status"),
          productName: Product.name,
          productSku: Product.sku,
          locationName: Location.name,
          totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
        })
        .from(Stock)
        .leftJoin(Product, eq(Stock.productId, Product.id))
        .leftJoin(Location, eq(Stock.location_id, Location.id))
        .where(and(...conditions))
        .orderBy(desc(Stock.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const total = results[0]?.totalCount ?? 0;

      // Status counts for KPI cards: respect tenant, location access, and
      // the supplier filter so the cards match what's on screen. Status/search
      // are deliberately not applied here (they would make the cards circular).
      const statsConditions = [
        eq(Stock.tenant_id, ctx.tenantId),
        isNull(Location.deletedAt),
        isNull(Stock.deletedAt),
      ];
      if (locationFilter) {
        statsConditions.push(eq(Stock.location_id, locationFilter));
      }
      if (supplierPredicate) {
        statsConditions.push(supplierPredicate);
      }

      const statsQuery = ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          low: sql<number>`COUNT(*) FILTER (WHERE ${Stock.minimumStockLevel} IS NOT NULL AND ${Stock.qty} <= ${Stock.minimumStockLevel} AND ${Stock.qty} > 0)`,
          outOfStock: sql<number>`COUNT(*) FILTER (WHERE ${Stock.qty} = 0)`,
        })
        .from(Stock)
        .leftJoin(Location, eq(Stock.location_id, Location.id));
      // Only join Product when needed — keeps the common case cheap.
      if (supplierPredicate) {
        statsQuery.leftJoin(Product, eq(Stock.productId, Product.id));
      }
      const [statusCounts] = await statsQuery.where(and(...statsConditions));

      const statsTotal = statusCounts?.total ?? 0;
      const statsLow = statusCounts?.low ?? 0;
      const statsOutOfStock = statusCounts?.outOfStock ?? 0;

      // Fetch base unit names for products in the result set
      const productIds = results
        .map((r) => r.productId)
        .filter((id): id is string => id != null);

      let baseUnitMap = new Map<string, string>();
      // Map of "product_id:unit_name" → conversion_factor for display unit lookups
      let conversionMap = new Map<string, number>();
      if (productIds.length > 0) {
        const unitConversions = await ctx.db
          .select({
            product_id: ProductUnitConversion.product_id,
            unit_name: ProductUnitConversion.unit_name,
            conversion_factor: ProductUnitConversion.conversion_factor,
            is_base_unit: ProductUnitConversion.is_base_unit,
          })
          .from(ProductUnitConversion)
          .where(
            inArray(ProductUnitConversion.product_id, productIds),
          );
        for (const uc of unitConversions) {
          if (uc.is_base_unit) {
            baseUnitMap.set(uc.product_id, uc.unit_name);
          }
          conversionMap.set(`${uc.product_id}:${uc.unit_name}`, uc.conversion_factor);
        }
      }

      return {
        stocks: results.map(({ totalCount, productName, productSku, locationName, ...rest }) => {
          // Resolve display unit conversion factor
          const displayUnit = rest.display_unit;
          const displayFactor = displayUnit
            ? conversionMap.get(`${rest.productId}:${displayUnit}`) ?? null
            : null;

          return {
            ...rest,
            displayConversionFactor: displayFactor,
            product: productName ? {
              id: rest.productId ?? "",
              name: productName,
              sku: productSku,
              baseUnitName: baseUnitMap.get(rest.productId ?? "") ?? null,
            } : null,
            location: locationName ? { id: rest.location_id ?? "", name: locationName } : null,
          };
        }),
        pagination: {
          total,
          limit: input.limit,
          offset: input.offset,
          page: Math.floor(input.offset / input.limit) + 1,
          totalPages: Math.ceil(total / input.limit),
        },
        statusCounts: {
          total: statsTotal,
          ok: statsTotal - statsLow - statsOutOfStock,
          low: statsLow,
          outOfStock: statsOutOfStock,
        },
      };
    }

    // Full mode: eager-load all relations
    const stocks = await ctx.db.query.Stock.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        product: {
          with: {
            category: true,
            unitConversions: true,
          },
        },
        location: true,
      },
    });

    // Filter out stocks with deleted locations
    let filteredStocks = stocks.filter((stock) => !stock.location?.deletedAt);

    // Apply supplier filter (full mode runs in JS to keep parity with search)
    if (input.supplier_id === "none") {
      filteredStocks = filteredStocks.filter((stock) => !stock.product?.supplier_id);
    } else if (input.supplier_id) {
      filteredStocks = filteredStocks.filter(
        (stock) => stock.product?.supplier_id === input.supplier_id,
      );
    }

    // Apply search filter
    if (input.search) {
      const searchLower = input.search.toLowerCase();
      filteredStocks = filteredStocks.filter((stock) => {
        const productNameMatch = stock.product?.name.toLowerCase().includes(searchLower);
        const productSkuMatch = stock.product?.sku?.toLowerCase().includes(searchLower);
        const locationNameMatch = stock.location?.name.toLowerCase().includes(searchLower);
        return productNameMatch || productSkuMatch || locationNameMatch;
      });
    }

    // Calculate status for each stock
    const stocksWithStatus = filteredStocks.map((stock) => {
      let status: "OK" | "LOW" | "OUT_OF_STOCK";

      if (stock.qty === 0) {
        status = "OUT_OF_STOCK";
      } else if (
        stock.minimumStockLevel &&
        stock.qty <= stock.minimumStockLevel
      ) {
        status = "LOW";
      } else {
        status = "OK";
      }

      return {
        ...stock,
        status,
      };
    });

    // Apply status filter if provided
    const statusFilteredStocks = input.status
      ? stocksWithStatus.filter((stock) => stock.status === input.status)
      : stocksWithStatus;

    // Apply pagination after filtering and status calculation
    const paginatedStocks = statusFilteredStocks.slice(
      input.offset,
      input.offset + input.limit
    );

    const totalCount = statusFilteredStocks.length;
    const totalPages = Math.ceil(totalCount / input.limit);
    const currentPage = Math.floor(input.offset / input.limit) + 1;

    // Compute status counts from the full unfiltered set (before status/search filters)
    const fullTotal = stocksWithStatus.length;
    const fullLow = stocksWithStatus.filter((s) => s.status === "LOW").length;
    const fullOutOfStock = stocksWithStatus.filter((s) => s.status === "OUT_OF_STOCK").length;

    return {
      stocks: paginatedStocks,
      pagination: {
        total: totalCount,
        limit: input.limit,
        offset: input.offset,
        page: currentPage,
        totalPages,
      },
      statusCounts: {
        total: fullTotal,
        ok: fullTotal - fullLow - fullOutOfStock,
        low: fullLow,
        outOfStock: fullOutOfStock,
      },
    };
  });
