import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { eq, isNull, and, or, ilike, desc, sql } from "drizzle-orm";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { Location } from "../../../db/schema/location.ts";
import { getLocationFilter } from "../../../utils/locationFilter.ts";
import { calculateSubtotal } from "../../../utils/poTotals.ts";
import { roundToCent } from "../../../utils/money.ts";
import { ORDER_STATUS } from "../../../types/orders.ts";
import { TRPCError } from "@trpc/server";
import { computeAllowedActions } from "./helpers/permissionMatrix.ts";
import type { userRoles } from "../../../types/user.ts";

export const getAllPuchaseOrders = authedProcedure
  .input(
    z.object({
      search: z.string().optional(),
      includeDeleted: z.boolean().optional().default(false),
      location_id: z.string().optional(), // Optional filter for admins, enforced for regular users
      supplier_id: z.string().uuid().optional(),
      status: z.enum([
        ORDER_STATUS.draft,
        ORDER_STATUS.pendingApproval,
        ORDER_STATUS.approved,
        ORDER_STATUS.ordered,
        ORDER_STATUS.partiallyReceived,
        ORDER_STATUS.received,
        ORDER_STATUS.rejected,
        ORDER_STATUS.cancelled,
      ]).optional(), // Optional status filter
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

    // Build shared filter conditions
    const conditions = [eq(PurchaseOrder.tenant_id, ctx.tenantId!)];

    if (!input.includeDeleted) {
      conditions.push(isNull(PurchaseOrder.deletedAt));
    }

    if (locationFilter) {
      conditions.push(eq(PurchaseOrder.destination_location_id, locationFilter));
    }

    if (input.status) {
      conditions.push(eq(PurchaseOrder.status, input.status));
    }

    if (input.supplier_id) {
      conditions.push(eq(PurchaseOrder.supplier_id, input.supplier_id));
    }

    // List mode: lightweight query with SQL joins + subqueries
    if (input.mode === "list") {
      // Search filtering via SQL WHERE (not in-memory)
      if (input.search) {
        conditions.push(
          or(
            ilike(PurchaseOrder.po_number, `%${input.search}%`),
            ilike(Supplier.name, `%${input.search}%`),
            ilike(Location.name, `%${input.search}%`),
          )!
        );
      }

      const results = await ctx.db
        .select({
          id: PurchaseOrder.id,
          po_number: PurchaseOrder.po_number,
          status: PurchaseOrder.status,
          currency: PurchaseOrder.currency,
          is_unlocked: PurchaseOrder.is_unlocked,
          createdAt: PurchaseOrder.createdAt,
          supplierName: Supplier.name,
          locationName: Location.name,
          itemsCount: sql<number>`(
            SELECT COUNT(*)::int FROM purchase_order_item
            WHERE purchase_order_id = ${PurchaseOrder.id}
            AND "deletedAt" IS NULL
          )`.as("items_count"),
          total: sql<number>`COALESCE((
            SELECT SUM(qty * COALESCE(unit_price, 0))
            FROM purchase_order_item
            WHERE purchase_order_id = ${PurchaseOrder.id}
            AND "deletedAt" IS NULL
          ), 0)`.as("total"),
          totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
        })
        .from(PurchaseOrder)
        .leftJoin(Supplier, eq(PurchaseOrder.supplier_id, Supplier.id))
        .leftJoin(Location, eq(PurchaseOrder.destination_location_id, Location.id))
        .where(and(...conditions))
        .orderBy(desc(PurchaseOrder.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const total = results[0]?.totalCount ?? 0;
      const userRole = ctx.user!.role as userRoles;

      return {
        results: results.map(({ totalCount, supplierName, locationName, total: rowTotal, ...rest }) => ({
          ...rest,
          // SQL SUM can drift by sub-cent; canonicalize on the way out so
          // list view matches the per-PO `getById` calculation.
          total: roundToCent(rowTotal),
          supplier: supplierName ? { name: supplierName } : null,
          destinationLocation: locationName ? { name: locationName } : null,
          allowedActions: computeAllowedActions(
            { status: rest.status, is_unlocked: rest.is_unlocked ?? false },
            userRole
          ),
        })),
        pagination: {
          total,
          limit: input.limit,
          offset: input.offset,
          page: Math.floor(input.offset / input.limit) + 1,
          totalPages: Math.ceil(total / input.limit),
        },
      };
    }

    // Full mode: eager-load all relations (used by consumers needing item details)
    const allOrders = await ctx.db.query.PurchaseOrder.findMany({
      where: and(...conditions),
      with: {
        purchaseOrderItems: {
          where: isNull(PurchaseOrderItem.deletedAt),
          with: { product: true }
        },
        supplier: true,
        destinationLocation: true,
      },
    });

    // Filter by search term in memory (full mode keeps backward compat)
    let filteredOrders = allOrders;
    if (input.search) {
      const searchLower = input.search.toLowerCase();
      filteredOrders = allOrders.filter((order) => {
        return (
          order.po_number?.toLowerCase().includes(searchLower) ||
          order.id.toLowerCase().includes(searchLower) ||
          order.supplier?.name.toLowerCase().includes(searchLower) ||
          order.destinationLocation?.name.toLowerCase().includes(searchLower)
        );
      });
    }

    // Get total count before pagination
    const total = filteredOrders.length;

    // Apply pagination
    const paginatedOrders = filteredOrders.slice(
      input.offset,
      input.offset + input.limit
    );

    // Add computed fields: itemsCount, total, allowedActions
    const userRole = ctx.user!.role as userRoles;
    const results = paginatedOrders.map((order) => ({
      ...order,
      itemsCount: order.purchaseOrderItems?.length || 0,
      total: calculateSubtotal(order.purchaseOrderItems || []),
      allowedActions: computeAllowedActions(
        { status: order.status, is_unlocked: order.is_unlocked ?? false },
        userRole
      ),
    }));

    return {
      results,
      pagination: {
        total,
        limit: input.limit,
        offset: input.offset,
        page: Math.floor(input.offset / input.limit) + 1,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  });
