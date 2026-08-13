import { and, eq, inArray, lte, isNotNull, isNull, sql } from "drizzle-orm";
import { InventoryCountEntry } from "../../../../db/schema/inventoryCountEntry.ts";
import { Stock } from "../../../../db/schema/stock.ts";
import { StockMovement } from "../../../../db/schema/stockMovement.ts";
import { ProductUnitConversion } from "../../../../db/schema/productUnitConversion.ts";
import { tryGetFactor, type UnitConversion } from "../../../../utils/unitConversion.ts";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import * as schema from "../../../../db/schema/index.ts";

type TransactionContext = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface ApplyCountToStockParams {
  sessionId: string;
  locationId: string;
  weekIdentifier: string;
  userId: string;
  tenantId: string;
}

export interface ApplyCountToStockResult {
  adjustedItems: number;
  skippedItems: number;
  hasLowStockItems: boolean;
}

/**
 * Reconciles Stock against a completed count's entries: for each counted
 * item, converts to base units using the factor frozen at count time, logs
 * a StockMovement for any variance, and applies that variance as an atomic
 * delta (not an overwrite — see the comment at the write site below).
 *
 * Shared by two call sites with identical stock-application needs but
 * different session-status transitions around it: approveCount.ts (a
 * manager/admin reviewing someone else's PENDING_REVIEW submission) and
 * completeSession.ts (an elevated user completing their own count, which
 * skips the review step entirely — see that file for why).
 */
export async function applyCountToStock(
  tx: TransactionContext,
  { sessionId, locationId, weekIdentifier, userId, tenantId }: ApplyCountToStockParams,
): Promise<ApplyCountToStockResult> {
  // Fetch all entries with stock data
  const entries = await tx.query.InventoryCountEntry.findMany({
    where: eq(InventoryCountEntry.session_id, sessionId),
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
            eq(ProductUnitConversion.tenant_id, tenantId),
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
        location_id: locationId,
        tenant_id: tenantId,
        change_qty: variance,
        movement_type: "COUNT_ADJUSTMENT",
        reason: entry.unit
          ? `Inventory count adjustment – ${weekIdentifier} (${entry.unit})${conversionInfo}${reviewNote}`
          : `Inventory count adjustment – ${weekIdentifier}${reviewNote}`,
        user_id: userId,
      });
    }

    // Apply the variance as an atomic delta rather than overwriting qty
    // outright — a flat `.set({ qty: qtyInBaseUnits })` would silently
    // discard any stock movement that happened between the count
    // snapshot and this approval (a delivery received, a sale), even
    // though the StockMovement logged above implies a reconciliation.
    // Tenant guard is defense in depth — entry.stock_id is trusted
    // transitively via the already tenant-scoped session lookup the
    // caller performed, but every other Stock write in the codebase
    // scopes explicitly.
    if (variance !== 0) {
      await tx
        .update(Stock)
        .set({ qty: sql`${Stock.qty} + ${variance}` })
        .where(and(eq(Stock.id, entry.stock_id), eq(Stock.tenant_id, tenantId)));
    }

    adjustedItems++;
  }

  // Check if any items at this location are below minimum and have a par level
  const [lowStockCheck] = await tx
    .select({ exists: sql<boolean>`true` })
    .from(Stock)
    .where(
      and(
        eq(Stock.location_id, locationId),
        eq(Stock.tenant_id, tenantId),
        lte(Stock.qty, sql`${Stock.minimumStockLevel}`),
        isNotNull(Stock.parLevel),
        isNull(Stock.deletedAt),
      ),
    )
    .limit(1);

  return { adjustedItems, skippedItems, hasLowStockItems: !!lowStockCheck };
}
