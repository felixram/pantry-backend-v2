import { eq, and, isNull, inArray } from "drizzle-orm"
import { PurchaseOrder } from "../../db/schema/purchaseOrder.ts"
import { PurchaseOrderItem } from "../../db/schema/purchaseOrderItem.ts"
import { Invoice } from "../../db/schema/invoice.ts"
import { InvoiceItem } from "../../db/schema/invoiceItem.ts"
import { ORDER_STATUS } from "../../types/orders.ts"
import type { db as dbType } from "../../db/index.ts"
import type { InvoiceExtractionResult } from "../ai/geminiService.ts"
import { applyDiscount } from "../../utils/discountMath.ts"

interface POMatchResult {
  purchaseOrderId: string | null
  confidence: number
  poItems: Array<{
    poItemId: string
    productId: string
    qty: number
    unitPrice: number | null
    unit: string | null
    received_qty: number | null
  }>
}

/**
 * Match an invoice to an existing Purchase Order.
 *
 * Priority:
 * 0. Explicit PO id (e.g. "Attach Invoice" from a PO's own detail page) —
 *    that link was made intentionally by a person, not inferred, so it
 *    always wins over anything the AI extraction below might find instead.
 * 1. PO number reference from invoice
 * 2. Supplier + ORDERED status + item overlap scoring
 */
export async function matchPurchaseOrder(
  db: typeof dbType,
  tenantId: string,
  extracted: InvoiceExtractionResult,
  matchedSupplierId: string | null,
  matchedProductIds: (string | null)[],
  explicitPurchaseOrderId?: string | null
): Promise<POMatchResult> {
  const noMatch: POMatchResult = { purchaseOrderId: null, confidence: 0, poItems: [] }

  // 0. Explicit PO id
  if (explicitPurchaseOrderId) {
    const po = await db.query.PurchaseOrder.findFirst({
      where: and(
        eq(PurchaseOrder.id, explicitPurchaseOrderId),
        eq(PurchaseOrder.tenant_id, tenantId),
        isNull(PurchaseOrder.deletedAt)
      ),
      with: {
        purchaseOrderItems: true,
      },
    })

    if (po) {
      return {
        purchaseOrderId: po.id,
        confidence: 1,
        poItems: po.purchaseOrderItems.map((item) => ({
          poItemId: item.id,
          productId: item.product_id,
          qty: item.qty,
          unitPrice: item.unit_price,
          unit: item.unit,
          received_qty: item.received_qty,
        })),
      }
    }
    // Explicit id didn't resolve (deleted since upload, wrong tenant) —
    // fall through to normal AI-extraction matching below rather than
    // silently keeping a dangling reference.
  }

  // 1. PO number reference
  if (extracted.po_reference) {
    const po = await db.query.PurchaseOrder.findFirst({
      where: and(
        eq(PurchaseOrder.po_number, extracted.po_reference),
        eq(PurchaseOrder.tenant_id, tenantId),
        isNull(PurchaseOrder.deletedAt)
      ),
      with: {
        purchaseOrderItems: true,
      },
    })

    if (po) {
      return {
        purchaseOrderId: po.id,
        confidence: 0.95,
        poItems: po.purchaseOrderItems.map((item) => ({
          poItemId: item.id,
          productId: item.product_id,
          qty: item.qty,
          unitPrice: item.unit_price,
          unit: item.unit,
          received_qty: item.received_qty,
        })),
      }
    }
  }

  // 2. Supplier-scoped open POs (ORDERED or PARTIALLY_RECEIVED — a follow-up
  // invoice against an already-partial PO must still be matchable), then
  // fallback to all open POs
  const validProductIds = matchedProductIds.filter((id): id is string => id !== null)
  const openStatuses = [ORDER_STATUS.ordered, ORDER_STATUS.partiallyReceived]

  // Build candidate list: supplier-scoped first, then all open POs as fallback
  let candidatePOs = matchedSupplierId
    ? await db.query.PurchaseOrder.findMany({
        where: and(
          eq(PurchaseOrder.supplier_id, matchedSupplierId),
          eq(PurchaseOrder.tenant_id, tenantId),
          inArray(PurchaseOrder.status, openStatuses),
          isNull(PurchaseOrder.deletedAt)
        ),
        with: { purchaseOrderItems: true },
      })
    : []

  // If no supplier-scoped candidates, search all open POs for product overlap
  if (candidatePOs.length === 0 && validProductIds.length > 0) {
    candidatePOs = await db.query.PurchaseOrder.findMany({
      where: and(
        eq(PurchaseOrder.tenant_id, tenantId),
        inArray(PurchaseOrder.status, openStatuses),
        isNull(PurchaseOrder.deletedAt)
      ),
      with: { purchaseOrderItems: true },
    })
  }

  if (candidatePOs.length === 0) return noMatch

  // Score each candidate by product overlap
  let bestCandidate: {
    po: typeof candidatePOs[0]
    score: number
  } | null = null

  for (const po of candidatePOs) {
    const poProductIds = new Set(po.purchaseOrderItems.map((item) => item.product_id))
    const uniqueOverlap = new Set(validProductIds.filter((id) => poProductIds.has(id)))
    const overlapCount = uniqueOverlap.size
    const score = validProductIds.length > 0
      ? overlapCount / Math.max(new Set(validProductIds).size, poProductIds.size)
      : 0

    if (score > 0.3 && (!bestCandidate || score > bestCandidate.score)) {
      bestCandidate = { po, score }
    }
  }

  if (bestCandidate) {
    return {
      purchaseOrderId: bestCandidate.po.id,
      confidence: bestCandidate.score * 0.8,
      poItems: bestCandidate.po.purchaseOrderItems.map((item) => ({
        poItemId: item.id,
        productId: item.product_id,
        qty: item.qty,
        unitPrice: item.unit_price,
        unit: item.unit,
        received_qty: item.received_qty,
      })),
    }
  }

  return noMatch
}

// ─── Shared item-to-PO-item matching & discrepancy calculation ───

/** Normalized shape for an invoice line item used by the discrepancy engine */
export interface InvoiceLineForMatching {
  productId: string | null
  qty: number
  unitPrice: number
  discountPercent: number
  isOOS: boolean
}

/** Per-item discrepancy result */
export interface ItemDiscrepancyResult {
  matchedPoItemId: string | null
  hasQtyDiscrepancy: boolean
  hasPriceDiscrepancy: boolean
  qtyDiscrepancyAmount: number
  priceDiscrepancyAmount: number
}

/**
 * Match invoice line items to PO items by product_id and calculate discrepancies.
 *
 * Used by both:
 * - invoiceProcessor (initial processing, items from Gemini extraction)
 * - updateInvoiceMatch (manual PO re-assignment, items from DB)
 */
export function calculateItemDiscrepancies(
  items: InvoiceLineForMatching[],
  poItems: Array<{ poItemId: string; productId: string; qty: number; unitPrice: number | null; received_qty?: number | null }>
): ItemDiscrepancyResult[] {
  const poItemsByProduct = new Map(
    poItems.map((item) => [item.productId, item])
  )

  // Pre-compute aggregate receivable qty per PO item (excluding OOS lines)
  const receivableQtyByPoItem = new Map<string, number>()
  for (const item of items) {
    if (item.isOOS) continue
    if (!item.productId) continue
    const poItem = poItemsByProduct.get(item.productId)
    if (!poItem) continue
    receivableQtyByPoItem.set(
      poItem.poItemId,
      (receivableQtyByPoItem.get(poItem.poItemId) ?? 0) + item.qty
    )
  }

  const qtyDiscrepancyAssigned = new Set<string>()

  return items.map((item) => {
    const matchedPoItem = item.productId
      ? poItemsByProduct.get(item.productId)
      : undefined

    if (!matchedPoItem) {
      return {
        matchedPoItemId: null,
        hasQtyDiscrepancy: false,
        hasPriceDiscrepancy: false,
        qtyDiscrepancyAmount: 0,
        priceDiscrepancyAmount: 0,
      }
    }

    // Price discrepancy: compare effective (post-discount) price against PO price
    const effectivePrice = applyDiscount(item.unitPrice, item.discountPercent)
    const priceDiff = matchedPoItem.unitPrice !== null
      ? effectivePrice - matchedPoItem.unitPrice
      : 0
    const hasPriceDiscrepancy = matchedPoItem.unitPrice !== null && Math.abs(priceDiff) > 0.01

    // Qty discrepancy: aggregate across lines, assign once per PO item
    let hasQtyDiscrepancy = false
    let qtyDiscrepancyAmount = 0
    const alreadyAssigned = qtyDiscrepancyAssigned.has(matchedPoItem.poItemId)

    if (!item.isOOS && !alreadyAssigned) {
      const totalInvoiceQty = receivableQtyByPoItem.get(matchedPoItem.poItemId) ?? item.qty
      // Compare against what's still outstanding, not the item's full
      // original qty — once a prior invoice/receive has already covered
      // part of a PO item, a follow-up invoice correctly covering what's
      // left shouldn't be flagged as a quantity mismatch against the whole
      // order.
      const outstandingQty = matchedPoItem.qty - (matchedPoItem.received_qty ?? 0)
      const qtyDiff = totalInvoiceQty - outstandingQty
      hasQtyDiscrepancy = Math.abs(qtyDiff) > 0.01
      qtyDiscrepancyAmount = qtyDiff
      qtyDiscrepancyAssigned.add(matchedPoItem.poItemId)
    }

    return {
      matchedPoItemId: matchedPoItem.poItemId,
      hasQtyDiscrepancy,
      hasPriceDiscrepancy,
      qtyDiscrepancyAmount,
      priceDiscrepancyAmount: priceDiff,
    }
  })
}

/**
 * Recompute and persist qty/price discrepancy fields for every item on an
 * invoice, against its currently matched PO (aggregate qty discrepancy
 * depends on every line sharing a matched_po_item_id, not just the one that
 * changed). Call this after any mutation that changes a field the
 * calculation depends on — confirmed qty/price, confirmed product, or the
 * OOS flag — none of which recomputed discrepancies on their own before,
 * leaving sibling lines' discrepancy badges stale after an edit.
 */
export async function recalculateInvoiceDiscrepancies(
  db: typeof dbType,
  invoiceId: string,
  tenantId: string
): Promise<void> {
  const invoice = await db.query.Invoice.findFirst({
    where: and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)),
    with: { items: true },
  })
  if (!invoice) return

  if (!invoice.matched_purchase_order_id) {
    // No PO to compare against — clear any stale discrepancy data rather
    // than leaving it pointing at a match that no longer applies.
    for (const item of invoice.items) {
      if (!item.has_qty_discrepancy && !item.has_price_discrepancy && item.matched_po_item_id === null) continue
      await db
        .update(InvoiceItem)
        .set({
          matched_po_item_id: null,
          has_qty_discrepancy: false,
          has_price_discrepancy: false,
          qty_discrepancy_amount: null,
          price_discrepancy_amount: null,
        })
        .where(eq(InvoiceItem.id, item.id))
    }
    return
  }

  const po = await db.query.PurchaseOrder.findFirst({
    where: and(eq(PurchaseOrder.id, invoice.matched_purchase_order_id), eq(PurchaseOrder.tenant_id, tenantId)),
    with: { purchaseOrderItems: true },
  })
  if (!po) return

  const poItems = po.purchaseOrderItems.map((item) => ({
    poItemId: item.id,
    productId: item.product_id,
    qty: item.qty,
    unitPrice: item.unit_price,
    received_qty: item.received_qty,
  }))

  const linesForMatching: InvoiceLineForMatching[] = invoice.items.map((item) => ({
    productId: item.confirmed_product_id || item.matched_product_id,
    qty: item.confirmed_qty ?? item.extracted_qty ?? 0,
    unitPrice: item.confirmed_unit_price ?? item.extracted_unit_price ?? 0,
    discountPercent: item.extracted_discount_percent ?? 0,
    isOOS: item.is_out_of_stock ?? false,
  }))

  const discrepancies = calculateItemDiscrepancies(linesForMatching, poItems)

  for (let i = 0; i < invoice.items.length; i++) {
    const d = discrepancies[i]!
    await db
      .update(InvoiceItem)
      .set({
        matched_po_item_id: d.matchedPoItemId,
        has_qty_discrepancy: d.hasQtyDiscrepancy,
        has_price_discrepancy: d.hasPriceDiscrepancy,
        qty_discrepancy_amount: d.qtyDiscrepancyAmount,
        price_discrepancy_amount: d.priceDiscrepancyAmount,
      })
      .where(eq(InvoiceItem.id, invoice.items[i]!.id))
  }
}
