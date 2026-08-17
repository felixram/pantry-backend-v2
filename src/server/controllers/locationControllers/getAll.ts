import { and, eq, getTableColumns, ilike, isNull, isNotNull, or, sql, asc, desc } from "drizzle-orm";
import { authedProcedure } from "../../trpc.ts";
import { z } from "zod";
import { Location } from "../../../db/schema/location.ts";
import { TRPCError } from "@trpc/server";
import { getLocationFilter } from "../../../utils/locationFilter.ts";

export const getAllLocationsProcedure = authedProcedure
  .input(
    z.object({
      includeInactive: z.boolean().default(false).optional(),
      includeDeleted: z.boolean().default(false).optional(),
      search: z.string().optional(),
      limit: z.number().optional().default(10),
      offset: z.number().optional().default(0),
      sortByStatus: z.enum(["asc", "desc"]).optional(),
      columns: z.array(z.enum(["id", "name"])).optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const searchFilters = input.search
      ? or(
          ilike(Location.name, `%${input.search}%`),
          ilike(Location.address, `%${input.search}%`),
          ilike(Location.postalCode, `%${input.search}%`),
          ilike(Location.city, `%${input.search}%`),
        )
      : sql`TRUE`;

    // MANAGER/USER only ever see their own location (a single row); ADMIN
    // sees every location tenant-wide.
    const scopedLocationId = getLocationFilter(ctx.user, ctx.userLocationId, undefined);
    const locationScope = scopedLocationId ? eq(Location.id, scopedLocationId) : sql`TRUE`;

    // When sorting by status, automatically include inactive locations
    const shouldIncludeInactive = input.includeInactive || !!input.sortByStatus;

    // Build filter based on flags:
    // - includeDeleted: show ONLY deleted items
    // - includeInactive: show ONLY inactive items (non-deleted)
    // - default: show only active, non-deleted items
    const filters = and(
      eq(Location.tenant_id, ctx.tenantId),
      input.includeDeleted
        ? sql`TRUE`  // Deleted items can have any active status
        : shouldIncludeInactive
          ? eq(Location.active, false)  // Show ONLY inactive items
          : eq(Location.active, true),   // Show only active items
      input.includeDeleted
        ? isNotNull(Location.deletedAt)  // Show ONLY deleted items
        : isNull(Location.deletedAt),     // Show only non-deleted items
      searchFilters,
      locationScope,
    );

    // Determine order by clause based on sortByStatus
    // asc = Active first (true before false), desc = Inactive first (false before true)
    const orderByClause = input.sortByStatus
      ? input.sortByStatus === "asc"
        ? [desc(Location.active), desc(Location.id)]  // true (Active) first
        : [asc(Location.active), desc(Location.id)]   // false (Inactive) first
      : [desc(Location.id)];

    // When columns param is provided, return only requested fields (lightweight for dropdowns)
    const selectFields = input.columns
      ? {
          ...(input.columns.includes("id") ? { id: Location.id } : {}),
          ...(input.columns.includes("name") ? { name: Location.name } : {}),
          totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
        }
      : {
          ...getTableColumns(Location),
          totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
        }

    const results = await ctx.db
      .select(selectFields)
      .from(Location)
      .where(filters)
      .orderBy(...orderByClause)
      .limit(input.limit)
      .offset(input.offset);

    // Transform results: add 'isActive' for full responses, skip for minimal
    const transformedResults = input.columns
      ? results
      : results.map((location: any) => ({
          ...location,
          isActive: location.active,
        }));

    return {
      results: transformedResults,
      pagination: {
        total: results[0]?.totalCount ?? 0,
        limit: input.limit,
        offset: input.offset,
        page: Math.floor(input.offset / input.limit) + 1,
        totalPages: Math.ceil((results[0]?.totalCount ?? 0) / input.limit),
      },
    };
  });
