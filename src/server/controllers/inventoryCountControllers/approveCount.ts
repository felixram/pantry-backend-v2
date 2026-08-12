import { z } from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, lte, isNotNull, isNull, sql } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { InventoryCountEntry } from "../../../db/schema/inventoryCountEntry.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts";
import {
  tryGetFactor,
  type UnitConversion,
} from "../../../utils/unitConversion.ts";
import { isLocationScoped } from "../../../types/user.ts";

export const approveCount = adminMutation
  .input(z.object({ session_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    return await ctx.db.transaction(async (tx) => {
      const session = await tx.query.InventoryCountSession.findFirst({
        where: and(
          eq(InventoryCountSession.id, input.session_id),
          eq(InventoryCountSession.tenant_id, ctx.tenantId!),
        ),
      });

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Count session not found" });
      }

      // Location access check for managers
      if (isLocationScoped(ctx.user!.role) && ctx.userLocationId && session.location_id !== ctx.userLocationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this count session" });
      }

      if (session.status !== INVENTORY_COUNT_STATUS.pending_review) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This session is not pending review" });
      }

      // Fetch all entries with stock data
      const entries = await tx.query.InventoryCountEntry.findMany({
        where: eq(InventoryCountEntry.session_id, input.session_id),
        with: { stock: true },
      });

      // Pre-fetch unit conversions for all products in this count. Only used
      // as a fallback for legacy entries with no frozen unit_conversion_factor.
      const productIds = entries.map((e) => e.product_id);
      const allConversions =
        productIds.length > 0
          ? await tx.query.ProductUnitConversion.findMany({
              where: and(
                inArray(ProductUnitConversion.product_id, productIds),
                eq(ProductUnitConversion.tenant_id, ctx.tenantId!),
              ),
            })
          : [];

      const conversionsByProduct = new Map<string, UnitConversion[]>();
      for (const conv of allConversions) {
        const list = conversionsByProduct.get(conv.product_id) ?? [];
        list.push(conv);
        conversionsByProduct.set(conv.product_id, list);
      }

      let adjustedItems = 0;
      let skippedItems = 0;

      for (const entry of entries) {
        // Use reviewed_qty if set, otherwise fall back to counted_qty
        const effectiveQty = entry.reviewed_qty ?? entry.counted_qty;

        // Skip items that were not counted (and not reviewed)
        if (effectiveQty === null || effectiveQty === undefined) {
          skippedItems++;
          continue;
        }

        // Convert to base units using the factor frozen on the entry when it
        // was counted — approval should honor count-time intent even if the
        // product's conversion factor was edited since. Only legacy rows
        // (recorded before this column existed) fall back to a live lookup.
        const productConversions = conversionsByProduct.get(entry.product_id) ?? [];
        const conversionFactor =
          entry.unit_conversion_factor ?? tryGetFactor(productConversions, entry.unit) ?? 1;
        const qtyInBaseUnits = effectiveQty * conversionFactor;

        const variance = qtyInBaseUnits - entry.expected_qty;

        // Create a StockMovement for any variance
        if (variance !== 0) {
          const conversionInfo =
            conversionFactor > 1
              ? ` [${effectiveQty} ${entry.unit} = ${qtyInBaseUnits} base units]`
              : "";
          const reviewNote = entry.reviewed_qty !== null ? " (reviewed)" : "";
          await tx.insert(StockMovement).values({
            product_id: entry.product_id,
            location_id: session.location_id,
            tenant_id: ctx.tenantId!,
            change_qty: variance,
            movement_type: "COUNT_ADJUSTMENT",
            reason: entry.unit
              ? `Inventory count adjustment – ${session.week_identifier} (${entry.unit})${conversionInfo}${reviewNote}`
              : `Inventory count adjustment – ${session.week_identifier}${reviewNote}`,
            user_id: ctx.user!.id,
          });
        }

        // Apply the variance as an atomic delta rather than overwriting qty
        // outright — a flat `.set({ qty: qtyInBaseUnits })` would silently
        // discard any stock movement that happened between the count
        // snapshot and this approval (a delivery received, a sale), even
        // though the StockMovement logged above implies a reconciliation.
        // Tenant guard is defense in depth — entry.stock_id is trusted
        // transitively via the already tenant-scoped session lookup above,
        // but every other Stock write in the codebase scopes explicitly.
        if (variance !== 0) {
          await tx
            .update(Stock)
            .set({ qty: sql`${Stock.qty} + ${variance}` })
            .where(and(eq(Stock.id, entry.stock_id), eq(Stock.tenant_id, ctx.tenantId!)));
        }

        adjustedItems++;
      }

      // Mark session as completed
      await tx
        .update(InventoryCountSession)
        .set({
          status: INVENTORY_COUNT_STATUS.completed,
          completed_at: new Date(),
          completed_by: session.completed_by, // keep original submitter
          reviewed_by: ctx.user!.id,
        })
        .where(eq(InventoryCountSession.id, input.session_id));

      // Check if any items at this location are below minimum and have a par level
      const [lowStockCheck] = await tx
        .select({ exists: sql<boolean>`true` })
        .from(Stock)
        .where(
          and(
            eq(Stock.location_id, session.location_id!),
            eq(Stock.tenant_id, ctx.tenantId!),
            lte(Stock.qty, sql`${Stock.minimumStockLevel}`),
            isNotNull(Stock.parLevel),
            isNull(Stock.deletedAt),
          ),
        )
        .limit(1);

      return {
        message: "Inventory count approved and stock updated",
        adjustedItems,
        skippedItems,
        weekIdentifier: session.week_identifier,
        hasLowStockItems: !!lowStockCheck,
        location_id: session.location_id,
        session_id: input.session_id,
      };
    });
  });
