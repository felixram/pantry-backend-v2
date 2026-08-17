import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { PurchaseOrderItem } from "../../../../db/schema/purchaseOrderItem.ts";
import { PurchaseOrderAudit } from "../../../../db/schema/purchaseOrder_audit_log.ts";
import { Stock } from "../../../../db/schema/stock.ts";
import { StockMovement } from "../../../../db/schema/stockMovement.ts";
import { ProductUnitConversion } from "../../../../db/schema/productUnitConversion.ts";
import {
  tryGetFactor,
  type UnitConversion,
} from "../../../../utils/unitConversion.ts";
import * as schema from "../../../../db/schema/index.ts";

type TransactionContext = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Received item with actual quantity
 */
export interface ReceivedItemQuantity {
  itemId: string;
  receivedQty: number;
  notes?: string | undefined;
}

/**
 * Receives a purchase order and updates stock levels
 * This function is called when a PO status changes to RECEIVED
 *
 * @param tx - Database transaction context
 * @param purchaseOrderId - ID of the purchase order being received
 * @param destinationLocationId - Location where stock should be received
 * @param userId - ID of user receiving the order
 * @param tenantId - ID of the tenant for data isolation
 * @param receivedItems - Items with actual received quantities. When omitted
 *                        entirely, every PO item defaults to its full
 *                        expected qty (the "receive everything" convenience
 *                        mode). When provided — even as an empty array — it
 *                        is treated as the complete, itemized list: any PO
 *                        item NOT included is left untouched (not defaulted
 *                        to its full qty). This is what makes it safe to
 *                        call from invoice confirmation with only the items
 *                        that invoice actually covers, without silently
 *                        completing the rest of the PO.
 * @param discrepancyReason - Optional reason for any quantity discrepancies
 * @returns Summary of stock updates and the PO's resulting status
 */
export async function receivePurchaseOrder(
  tx: TransactionContext,
  purchaseOrderId: string,
  destinationLocationId: string,
  userId: string,
  tenantId: string,
  receivedItems?: ReceivedItemQuantity[],
  discrepancyReason?: string
): Promise<{ summary: string; resultStatus: "RECEIVED" | "PARTIALLY_RECEIVED" | null }> {
  // Itemized mode: caller passed an explicit (possibly empty) list, so only
  // those items should move — see the receivedItems doc comment above.
  const isItemizedList = receivedItems !== undefined;

  // 1. Get all items in the purchase order
  const orderItems = await tx.query.PurchaseOrderItem.findMany({
    where: and(eq(PurchaseOrderItem.purchase_order_id, purchaseOrderId), isNull(PurchaseOrderItem.deletedAt)),
    with: {
      product: true,
    },
  });

  if (orderItems.length === 0) {
    return { summary: "No items to receive", resultStatus: null };
  }

  // Create a map for received quantities if provided
  const receivedQtyMap = new Map<string, ReceivedItemQuantity>(
    receivedItems?.map((item) => [item.itemId, item]) || []
  );

  // Pre-fetch unit conversions for all products in this PO, indexed by productId.
  // Only used as a fallback for legacy items with no frozen unit_conversion_factor.
  const productIds = orderItems.map(item => item.product_id);
  const allConversions = await tx.query.ProductUnitConversion.findMany({
    where: and(
      inArray(ProductUnitConversion.product_id, productIds),
      eq(ProductUnitConversion.tenant_id, tenantId),
    ),
  });

  const conversionsByProduct = new Map<string, UnitConversion[]>();
  for (const conv of allConversions) {
    const list = conversionsByProduct.get(conv.product_id) ?? [];
    list.push(conv);
    conversionsByProduct.set(conv.product_id, list);
  }

  // 2. Pre-fetch all existing stock at destination location (avoid N+1 queries)
  const existingStocks = await tx.query.Stock.findMany({
    where: and(eq(Stock.location_id, destinationLocationId), eq(Stock.tenant_id, tenantId)),
  });

  // Create a map for O(1) lookups: productId -> Stock
  const stockByProductId = new Map(
    existingStocks.map((stock) => [stock.productId, stock])
  );

  const stockUpdates: Array<{
    productId: string;
    oldQty: number;
    newQty: number;
  }> = [];

  const discrepancies: Array<{
    itemId: string;
    productId: string;
    productName: string;
    expectedQty: number;
    receivedQty: number;
    notes?: string | undefined;
  }> = [];

  // 3. Process each item
  for (const item of orderItems) {
    const receivedItemData = receivedQtyMap.get(item.id);

    // Itemized mode: an item this batch doesn't mention is untouched — not
    // defaulted to its full qty. Without this, confirming an invoice that
    // only covers 1 of a PO's 3 items would silently mark all 3 as fully
    // received.
    if (isItemizedList && !receivedItemData) continue;

    // Get the received quantity (either from receivedItems or, in
    // non-itemized "receive everything" mode, the expected qty)
    const actualReceivedQty = receivedItemData?.receivedQty ?? item.qty;
    const itemNotes = receivedItemData?.notes;

    // Convert received qty to base units using the factor frozen on the item
    // at order time — receiving should honor order-time intent even if the
    // product's conversion factor was edited since. Only legacy rows (created
    // before this column existed) fall back to a live conversions lookup.
    const productConversions = conversionsByProduct.get(item.product_id) ?? [];
    const conversionFactor =
      item.unit_conversion_factor ?? tryGetFactor(productConversions, item.unit) ?? 1;
    const baseQtyToAdd = actualReceivedQty * conversionFactor;

    // Compare against what was still outstanding before this event, not the
    // item's full original qty — once partial receiving is normal, a
    // deliberate partial delivery isn't a "discrepancy" against the whole
    // order, only against what this batch was actually expected to cover.
    const priorReceivedQty = item.received_qty ?? 0;
    const outstandingQty = item.qty - priorReceivedQty;

    // Track discrepancies
    if (actualReceivedQty !== outstandingQty) {
      discrepancies.push({
        itemId: item.id,
        productId: item.product_id,
        productName: item.product?.name || "Unknown Product",
        expectedQty: outstandingQty,
        receivedQty: actualReceivedQty,
        notes: itemNotes,
      });
    }

    // Update the item with received quantity and notes — accumulated, not
    // overwritten, so a second partial receive against the same item
    // doesn't lose track of the first one's progress (Stock's own qty write
    // below was already correctly incremental; this column just hadn't
    // matched that).
    await tx
      .update(PurchaseOrderItem)
      .set({
        received_qty: sql`COALESCE(${PurchaseOrderItem.received_qty}, 0) + ${actualReceivedQty}`,
        received_notes: itemNotes || null,
      })
      .where(eq(PurchaseOrderItem.id, item.id));

    // Only update stock if received qty > 0
    if (actualReceivedQty > 0) {
      // Snapshot for the returned summary only — the actual write below is
      // atomic and doesn't depend on this value.
      const existingStock = stockByProductId.get(item.product_id);
      const oldQty = existingStock?.qty ?? 0;

      // Atomic upsert — one statement for both "stock row exists, increment
      // it" and "no row yet, create it," closing the lost-update race the
      // previous read-a-snapshot-then-write sequence had (concurrent
      // receives/adjustments against the same row could otherwise clobber
      // each other), same pattern as transferStock's destination write.
      const [updated] = await tx
        .insert(Stock)
        .values({
          location_id: destinationLocationId,
          productId: item.product_id,
          qty: baseQtyToAdd,
          minimumStockLevel: 0,
          tenant_id: tenantId,
        })
        .onConflictDoUpdate({
          target: [Stock.location_id, Stock.productId],
          set: { qty: sql`${Stock.qty} + ${baseQtyToAdd}` },
        })
        .returning();

      stockUpdates.push({
        productId: item.product_id,
        oldQty,
        newQty: updated?.qty ?? oldQty + baseQtyToAdd,
      });

      // Log stock movement for audit trail
      const conversionInfo = conversionFactor > 1
        ? ` (${actualReceivedQty} ${item.unit} × ${conversionFactor} = ${baseQtyToAdd} base units)`
        : "";
      const reasonSuffix = actualReceivedQty !== outstandingQty
        ? ` (expected: ${outstandingQty}, received: ${actualReceivedQty})`
        : "";
      await tx.insert(StockMovement).values({
        product_id: item.product_id,
        location_id: destinationLocationId,
        change_qty: baseQtyToAdd,
        movement_type: "PO_RECEIVE",
        reason: `Purchase Order #${purchaseOrderId} received${reasonSuffix}${conversionInfo}`,
        user_id: userId,
        tenant_id: tenantId,
      });
    }
  }

  // 4. Log discrepancies to audit table if any
  if (discrepancies.length > 0) {
    await tx.insert(PurchaseOrderAudit).values({
      purchaseOrderId,
      userId,
      fieldChanged: "receiving_discrepancy",
      oldValue: JSON.stringify(
        discrepancies.map((d) => ({
          productId: d.productId,
          productName: d.productName,
          expectedQty: d.expectedQty,
        }))
      ),
      newValue: JSON.stringify(
        discrepancies.map((d) => ({
          productId: d.productId,
          productName: d.productName,
          receivedQty: d.receivedQty,
          notes: d.notes,
        }))
      ),
      reason: discrepancyReason || "Quantity discrepancy during receiving",
    });
  }

  // 5. Compute the PO's resulting status from real coverage, not from what
  // the caller asked for — re-read every item's post-write received_qty
  // against its ordered qty. Only meaningful if this batch actually moved
  // something (stockUpdates empty means every entered qty was 0 — no real
  // progress, so the PO's status shouldn't change).
  let resultStatus: "RECEIVED" | "PARTIALLY_RECEIVED" | null = null;
  if (stockUpdates.length > 0) {
    const finalItems = await tx.query.PurchaseOrderItem.findMany({
      where: and(eq(PurchaseOrderItem.purchase_order_id, purchaseOrderId), isNull(PurchaseOrderItem.deletedAt)),
      columns: { qty: true, received_qty: true },
    });
    const allCovered = finalItems.every((i) => (i.received_qty ?? 0) >= i.qty);
    resultStatus = allCovered ? "RECEIVED" : "PARTIALLY_RECEIVED";
  }

  // Return summary
  const discrepancySummary = discrepancies.length > 0
    ? `, ${discrepancies.length} items with quantity discrepancies`
    : "";
  return {
    summary: `Received ${orderItems.length} items, updated ${stockUpdates.length} stock records${discrepancySummary}`,
    resultStatus,
  };
}
