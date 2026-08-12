import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { eq, and, lte, sql, isNotNull, isNull } from "drizzle-orm";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { TRPCError } from "@trpc/server";

// Severity is "critical" once shortage exceeds this fraction of the
// configured minimum stock level, otherwise "warning".
const CRITICAL_SHORTAGE_RATIO = 0.5;

export const lowStockReport = authedProcedure
  .input(
    z.object({
      location_id: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
      sortBySeverity: z.enum(["asc", "desc"]).optional(),
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

    const conditions = [
      eq(Stock.tenant_id, ctx.tenantId), // Always filter by tenant
      lte(Stock.qty, sql`${Stock.minimumStockLevel}`),
      isNotNull(Stock.minimumStockLevel),
      isNull(Stock.deletedAt),
    ];

    // Enforce location filter (user's location or requested location)
    if (locationFilter) {
      conditions.push(eq(Stock.location_id, locationFilter));
    }

    // No DB-level limit/offset here — the matching set (stock at or below
    // its minimum) is inherently small, and severity/sort need to run over
    // the *complete* matching set before pagination is applied below,
    // otherwise "most critical first" isn't actually true past page 1.
    const lowStockItems = await ctx.db.query.Stock.findMany({
      where: and(...conditions),
      with: {
        product: {
          columns: { id: true, name: true, sku: true },
          with: {
            unitConversions: true,
          },
        },
        location: {
          columns: { id: true, name: true, deletedAt: true },
        },
      },
    });

    // Filter out stocks with deleted locations
    const activeStockItems = lowStockItems.filter((stock) => !stock.location?.deletedAt);

    // Calculate shortage and severity for each item
    const report = activeStockItems.map((stock) => {
      const shortage = (stock.minimumStockLevel || 0) - stock.qty;
      const isCritical = shortage > (stock.minimumStockLevel || 0) * CRITICAL_SHORTAGE_RATIO;
      return {
        ...stock,
        shortage,
        severity: isCritical ? "critical" : "warning",
      };
    });

    // Sort based on sortBySeverity parameter
    if (input.sortBySeverity === "asc") {
      // Warning first, then Critical (sorted by shortage ascending within each group)
      report.sort((a, b) => {
        if (a.severity === b.severity) return a.shortage - b.shortage;
        return a.severity === "warning" ? -1 : 1;
      });
    } else if (input.sortBySeverity === "desc") {
      // Critical first, then Warning (sorted by shortage descending within each group)
      report.sort((a, b) => {
        if (a.severity === b.severity) return b.shortage - a.shortage;
        return a.severity === "critical" ? -1 : 1;
      });
    } else {
      // Default: sort by shortage descending (most critical first)
      report.sort((a, b) => b.shortage - a.shortage);
    }

    // Pagination applied after sorting — the DB fetch above deliberately
    // has no LIMIT/OFFSET, so "most critical first" is true across the
    // whole result set, not just within whatever page happened to be
    // fetched from the database.
    const paginatedReport = report.slice(input.offset, input.offset + input.limit);

    return {
      items: paginatedReport,
      total: report.length,
      // Was `item.qty === 0` (out-of-stock count) despite the field name —
      // now actually counts items classified "critical" above.
      critical_count: report.filter((item) => item.severity === "critical").length,
      pagination: {
        limit: input.limit,
        offset: input.offset,
      },
    };
  });
