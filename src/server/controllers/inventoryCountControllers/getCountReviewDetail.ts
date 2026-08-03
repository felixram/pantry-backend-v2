import { z } from "zod";
import { adminProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { isLocationScoped } from "../../../types/user.ts";
import { fromBaseUnits, tryGetFactor } from "../../../utils/unitConversion.ts";

export const getCountReviewDetail = adminProcedure
  .input(z.object({ session_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const session = await ctx.db.query.InventoryCountSession.findFirst({
      where: and(
        eq(InventoryCountSession.id, input.session_id),
        eq(InventoryCountSession.tenant_id, ctx.tenantId),
      ),
      with: {
        location: { columns: { id: true, name: true } },
        completedByUser: { columns: { id: true, name: true, last_name: true } },
        entries: {
          with: {
            product: {
              columns: { id: true, name: true, sku: true, unit: true, defaultUnit: true },
              with: {
                category: { columns: { id: true, name: true } },
                unitConversions: {
                  columns: { unit_name: true, conversion_factor: true, is_base_unit: true },
                },
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Count session not found" });
    }

    // Location-scoped users can only view their own location
    if (isLocationScoped(ctx.user!.role) && ctx.userLocationId && session.location_id !== ctx.userLocationId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this count session" });
    }

    if (session.status !== INVENTORY_COUNT_STATUS.pending_review) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This session is not pending review" });
    }

    return {
      session: {
        id: session.id,
        week_identifier: session.week_identifier,
        location_name: session.location?.name ?? "Unknown",
        location_id: session.location_id,
        submitted_by_name: session.completedByUser
          ? `${session.completedByUser.name} ${session.completedByUser.last_name}`
          : "Unknown",
        submitted_at: session.submitted_at,
        status: session.status,
      },
      entries: session.entries.map((e) => {
        // expected_qty is stored in base units (it's a snapshot of Stock.qty),
        // but counted_qty / reviewed_qty are in `e.unit`. Convert expected into
        // the user's unit so both numbers — and the derived variance — are
        // comparable when rendered side-by-side under the same unit label.
        const conversions = e.product?.unitConversions ?? [];
        const hasConvertibleUnit = !!e.unit && tryGetFactor(conversions, e.unit) !== undefined;
        const expectedInUnit = hasConvertibleUnit
          ? fromBaseUnits(e.expected_qty, conversions, e.unit!)
          : e.expected_qty;

        return {
          id: e.id,
          product_id: e.product_id,
          stock_id: e.stock_id,
          product_name: e.product?.name ?? "Unknown",
          sku: e.product?.sku ?? "",
          category_name: e.product?.category?.name ?? "",
          unit: e.unit ?? e.product?.defaultUnit ?? e.product?.unit ?? "each",
          expected_qty: expectedInUnit,
          counted_qty: e.counted_qty,
          reviewed_qty: e.reviewed_qty,
          variance: e.counted_qty !== null ? e.counted_qty - expectedInUnit : null,
          unitConversions: conversions,
        };
      }),
    };
  });
