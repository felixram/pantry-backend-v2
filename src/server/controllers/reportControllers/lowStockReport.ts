import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { eq, and, lte, sql, isNotNull, isNull } from "drizzle-orm";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { TRPCError } from "@trpc/server";

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
      limit: input.limit,
      offset: input.offset,
    });

    // Filter out stocks with deleted locations
    const activeStockItems = lowStockItems.filter((stock) => !stock.location?.deletedAt);

    // Calculate shortage and severity for each item
    const report = activeStockItems.map((stock) => {
      const shortage = (stock.minimumStockLevel || 0) - stock.qty;
      // Severity: "critical" if shortage > 50% of minimum level, otherwise "warning"
      const isCritical = shortage > (stock.minimumStockLevel || 0) * 0.5;
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

    return {
      items: report,
      total: report.length,
      critical_count: report.filter((item) => item.qty === 0).length,
      pagination: {
        limit: input.limit,
        offset: input.offset,
      },
    };
  });
