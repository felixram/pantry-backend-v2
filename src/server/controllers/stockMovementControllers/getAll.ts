import z from "zod";
import { adminProcedure } from "../../trpc.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { eq, and, gte, lte, desc, sql, getTableColumns } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ROLES } from "../../../types/user.ts";

export const getAllStockMovements = adminProcedure
  .input(
    z.object({
      product_id: z.string().optional(),
      location_id: z.string().optional(),
      date_from: z.string().datetime().optional(),
      date_to: z.string().datetime().optional(),
      limit: z.number().min(1).max(1000).default(50),
      offset: z.number().min(0).default(0),
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // MANAGER can only see movements for their location
    const effectiveLocationId =
      ctx.user!.role === ROLES.manager
        ? ctx.userLocationId
        : input.location_id;

    // Build where conditions - always filter by tenant
    const conditions = [eq(StockMovement.tenant_id, ctx.tenantId)];

    if (input.product_id) {
      conditions.push(eq(StockMovement.product_id, input.product_id));
    }

    if (effectiveLocationId) {
      conditions.push(eq(StockMovement.location_id, effectiveLocationId));
    }

    if (input.date_from) {
      conditions.push(gte(StockMovement.createdAt, new Date(input.date_from)));
    }

    if (input.date_to) {
      conditions.push(lte(StockMovement.createdAt, new Date(input.date_to)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Query with total count using window function
    const results = await ctx.db
      .select({
        ...getTableColumns(StockMovement),
        totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
      })
      .from(StockMovement)
      .where(whereClause)
      .orderBy(desc(StockMovement.createdAt))
      .limit(input.limit)
      .offset(input.offset);

    // Get total from first result (window function returns same value for all rows)
    const total = results[0]?.totalCount ?? 0;

    // Fetch relations for each movement
    const movementIds = results.map((r) => r.id);

    // Only query relations if we have movements
    let movementsWithRelations: any[] = [];
    if (movementIds.length > 0) {
      movementsWithRelations = await ctx.db.query.StockMovement.findMany({
        where: sql`${StockMovement.id} IN ${movementIds}`,
        with: {
          user: true,
          products: true,
          location: true,
        },
        orderBy: [desc(StockMovement.createdAt)],
      });
    }

    return {
      movements: movementsWithRelations,
      total,
      pagination: {
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + results.length < total,
      },
    };
  });
