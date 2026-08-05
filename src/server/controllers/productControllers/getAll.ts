import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, ilike, or, count } from "drizzle-orm";
import { Product } from "../../../db/schema/product.ts";
import { allUnitPrices, findBaseUnit } from "../../../utils/unitConversion.ts";

/**
 * Get all products with DATABASE-LEVEL pagination and search.
 *
 * Performance optimizations:
 * 1. LIMIT/OFFSET at database level (not in-memory slicing)
 * 2. ILIKE search at database level (not JS .filter())
 * 3. COUNT query for total (no need to fetch all rows)
 * 4. Lightweight response (only needed fields from relations)
 */
export const getAllProductsProcedure = authedProcedure
  .input(
    z.object({
      search: z.string().optional(),
      supplier_id: z.union([z.string().uuid(), z.literal("none")]).optional(),
      category_id: z.union([z.string().uuid(), z.literal("none")]).optional(),
      includeDeleted: z.boolean().optional().default(false),
      limit: z.number().optional().default(10),
      offset: z.number().optional().default(0),
      cursor: z.number().optional(), // Alias for offset, used by infinite queries
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Use cursor as offset if provided (for infinite queries)
    const offset = input.cursor ?? input.offset;

    // Build base where conditions
    const baseConditions = and(
      eq(Product.tenant_id, ctx.tenantId),
      !input.includeDeleted ? isNull(Product.deletedAt) : undefined,
      input.supplier_id === "none"
        ? isNull(Product.supplier_id)
        : input.supplier_id
          ? eq(Product.supplier_id, input.supplier_id)
          : undefined,
      input.category_id === "none"
        ? isNull(Product.category_id)
        : input.category_id
          ? eq(Product.category_id, input.category_id)
          : undefined,
    );

    // Build search conditions (search in product name and SKU at DB level)
    let searchCondition;
    if (input.search) {
      const searchPattern = `%${input.search}%`;
      searchCondition = or(
        ilike(Product.name, searchPattern),
        Product.sku ? ilike(Product.sku, searchPattern) : undefined,
      );
    }

    const whereCondition = searchCondition
      ? and(baseConditions, searchCondition)
      : baseConditions;

    // Count + fetch run in parallel — independent queries, no need to
    // wait for one before starting the other.
    const [countResult, products] = await Promise.all([
      // Total count with filters (fast, single column)
      ctx.db
        .select({ count: count() })
        .from(Product)
        .where(whereCondition),

      // Paginated products with ONLY specific columns
      ctx.db.query.Product.findMany({
        where: whereCondition,
        // ONLY fetch what we need from the main table
        columns: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          defaultUnit: true,
          category_id: true,
          supplier_id: true,
          tax_rate_id: true,
          is_tax_exempt: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          supplier: {
            columns: { id: true, name: true }, // not fetch supplier address, phone, etc.
          },
          category: {
            columns: { id: true, name: true, tax_rate_id: true, is_tax_exempt: true },
          },
          version: {
            columns: {
              id: true,
              costPrice: true,
              costPriceUnit: true,
              sellingPrice: true,
              sellingPriceUnit: true,
              description: true,
            },
          },
          unitConversions: {
            columns: { id: true, unit_name: true, conversion_factor: true, is_base_unit: true, is_purchasable: true },
          },
        },
        limit: input.limit,
        offset: offset,
        orderBy: (product, { asc }) => [asc(product.name)],
      }),
    ]);

    const totalCount = Number(countResult[0]?.count ?? 0);
    const totalPages = Math.ceil(totalCount / input.limit);
    const currentPage = Math.floor(offset / input.limit) + 1;

    // Add calculated prices to each product
    const productsWithCalculatedPrices = products.map((product) => {
      const conversions = product.unitConversions ?? [];
      const version = product.version;

      const calculatedPrices =
        version && conversions.length > 0
          ? {
              cost: allUnitPrices(version.costPrice, version.costPriceUnit ?? null, conversions),
              selling:
                version.sellingPrice !== null && version.sellingPrice !== undefined
                  ? allUnitPrices(version.sellingPrice, version.sellingPriceUnit ?? null, conversions)
                  : null,
              baseUnitName: findBaseUnit(conversions)?.unit_name ?? null,
            }
          : null;

      return {
        ...product,
        calculatedPrices,
      };
    });

    return {
      products: productsWithCalculatedPrices,
      pagination: {
        total: totalCount,
        limit: input.limit,
        offset: offset,
        page: currentPage,
        totalPages,
      },
    };
  });
