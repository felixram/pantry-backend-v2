import { z } from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { InventoryCountEntry } from "../../../db/schema/inventoryCountEntry.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { CountSortOrder } from "../../../db/schema/countSortOrder.ts";
import { Location } from "../../../db/schema/location.ts";
import { getISOWeekIdentifier } from "../../../utils/dateUtils.ts";
import { ROLES } from "../../../types/user.ts";

export const startSession = authedMutation
  .input(z.object({ location_id: z.string().uuid().optional() }))
  .mutation(async ({ ctx, input }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
  }

  // Resolve effective location
  let effectiveLocationId: string;

  if (ctx.user!.role === ROLES.admin) {
    if (!input.location_id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Admin users must specify a location_id to start an inventory count",
      });
    }
    effectiveLocationId = input.location_id;
  } else {
    if (!ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You must have an assigned location to perform an inventory count",
      });
    }
    effectiveLocationId = ctx.userLocationId;
  }

  // Validate the location exists and belongs to this tenant
  const locationExists = await ctx.db.query.Location.findFirst({
    where: and(
      eq(Location.id, effectiveLocationId),
      eq(Location.tenant_id, ctx.tenantId),
      isNull(Location.deletedAt),
    ),
    columns: { id: true },
  });

  if (!locationExists) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Location not found",
    });
  }

  const weekId = getISOWeekIdentifier(new Date());

  // Check for an existing session this week for this location
  const existingSession = await ctx.db.query.InventoryCountSession.findFirst({
    where: and(
      eq(InventoryCountSession.tenant_id, ctx.tenantId),
      eq(InventoryCountSession.location_id, effectiveLocationId),
      eq(InventoryCountSession.week_identifier, weekId),
    ),
    with: {
      entries: {
        with: {
          product: {
            columns: { id: true, name: true, sku: true, unit: true, defaultUnit: true },
            with: {
              category: {
                columns: { id: true, name: true },
              },
              unitConversions: {
                columns: { unit_name: true, conversion_factor: true, is_base_unit: true },
              },
            },
          },
        },
      },
    },
  });

  if (existingSession) {
    if (existingSession.status === INVENTORY_COUNT_STATUS.completed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `The inventory count for ${weekId} is already completed`,
      });
    }
    // Resume existing ACTIVE session
    return { session: existingSession, entries: existingSession.entries };
  }

  // Create a new session inside a transaction
  return await ctx.db.transaction(async (tx) => {
    // Snapshot all non-deleted stock items at this location
    const stocks = await tx.query.Stock.findMany({
      where: and(
        eq(Stock.tenant_id, ctx.tenantId!),
        eq(Stock.location_id, effectiveLocationId),
      ),
      with: {
        product: {
          columns: { id: true, name: true, sku: true, unit: true, defaultUnit: true, deletedAt: true },
          with: {
            category: {
              columns: { id: true, name: true },
            },
            unitConversions: {
              columns: { unit_name: true, conversion_factor: true, is_base_unit: true },
            },
          },
        },
      },
    });

    // Filter out items with soft-deleted products
    const activeStocks = stocks.filter((s) => !s.product?.deletedAt && !s.deletedAt);

    // Get excluded product IDs from sort order config
    const excludedRows = await tx
      .select({ product_id: CountSortOrder.product_id })
      .from(CountSortOrder)
      .where(
        and(
          eq(CountSortOrder.tenant_id, ctx.tenantId!),
          eq(CountSortOrder.location_id, effectiveLocationId),
          eq(CountSortOrder.excluded, true)
        )
      );
    const excludedProductIds = new Set(excludedRows.map((r) => r.product_id));

    // Filter out excluded products
    const countableStocks = excludedProductIds.size > 0
      ? activeStocks.filter((s) => !excludedProductIds.has(s.productId))
      : activeStocks;

    if (countableStocks.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No stock items found at your location to count",
      });
    }

    // Insert the session
    const [session] = await tx
      .insert(InventoryCountSession)
      .values({
        tenant_id: ctx.tenantId!,
        location_id: effectiveLocationId,
        created_by: ctx.user!.id,
        week_identifier: weekId,
        status: INVENTORY_COUNT_STATUS.active,
      })
      .returning();

    // Snapshot entries for each stock item
    const entryValues = countableStocks.map((stock) => ({
      session_id: session!.id,
      stock_id: stock.id,
      product_id: stock.productId!,
      expected_qty: stock.qty,
      unit: stock.product?.defaultUnit ?? stock.product?.unit?.[0] ?? null,
    }));

    const entries = await tx
      .insert(InventoryCountEntry)
      .values(entryValues)
      .returning();

    // Build enriched entries for the response
    const stockMap = new Map(countableStocks.map((s) => [s.id, s]));
    const entriesWithProduct = entries.map((entry) => {
      const stock = stockMap.get(entry.stock_id)!;
      return {
        ...entry,
        product: stock.product,
      };
    });

    return { session, entries: entriesWithProduct };
  });
});
