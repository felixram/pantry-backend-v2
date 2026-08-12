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
  toBaseUnits,
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
 * @param receivedItems - Optional array of items with actual received quantities
 *                        If not provided, uses the expected qty from each item
 * @param discrepancyReason - Optional reason for any quantity discrepancies
 * @returns Summary of stock updates
 */
export async function receivePurchaseOrder(
  tx: TransactionContext,
  purchaseOrderId: string,
  destinationLocationId: string,
  userId: string,
  tenantId: string,
  receivedItems?: ReceivedItemQuantity[],
  discrepancyReason?: string
): Promise<string> {
  // 1. Get all items in the purchase order
  const orderItems = await tx.query.PurchaseOrderItem.findMany({
    where: and(eq(PurchaseOrderItem.purchase_order_id, purchaseOrderId), isNull(PurchaseOrderItem.deletedAt)),
    with: {
      product: true,
    },
  });

  if (orderItems.length === 0) {
    return "No items to receive";
  }

  // Create a map for received quantities if provided
  const receivedQtyMap = new Map<string, ReceivedItemQuantity>(
    receivedItems?.map((item) => [item.itemId, item]) || []
  );

  // Pre-fetch unit conversions for all products in this PO, indexed by productId
  const productIds = orderItems.map(item => item.product_id);
  const allConversions = await tx.query.ProductUnitConversion.findMany({
    where: inArray(ProductUnitConversion.product_id, productIds),
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
    // Get the received quantity (either from receivedItems or use expected qty)
    const receivedItemData = receivedQtyMap.get(item.id);
    const actualReceivedQty = receivedItemData?.receivedQty ?? item.qty;
    const itemNotes = receivedItemData?.notes;

    // Convert received qty to base units. Falls back to qty as-is when the
    // PO item has no unit (legacy data) or the unit is missing from conversions.
    const productConversions = conversionsByProduct.get(item.product_id) ?? [];
    const conversionFactor = tryGetFactor(productConversions, item.unit) ?? 1;
    const baseQtyToAdd = item.unit && conversionFactor !== 1
      ? toBaseUnits(actualReceivedQty, productConversions, item.unit)
      : actualReceivedQty;

    // Track discrepancies
    if (actualReceivedQty !== item.qty) {
      discrepancies.push({
        itemId: item.id,
        productId: item.product_id,
        productName: item.product?.name || "Unknown Product",
        expectedQty: item.qty,
        receivedQty: actualReceivedQty,
        notes: itemNotes,
      });
    }

    // Update the item with received quantity and notes
    await tx
      .update(PurchaseOrderItem)
      .set({
        received_qty: actualReceivedQty,
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
      const reasonSuffix = actualReceivedQty !== item.qty
        ? ` (expected: ${item.qty}, received: ${actualReceivedQty})`
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

  // Return summary
  const discrepancySummary = discrepancies.length > 0
    ? `, ${discrepancies.length} items with quantity discrepancies`
    : "";
  return `Received ${orderItems.length} items, updated ${stockUpdates.length} stock records${discrepancySummary}`;
}
