import { eq, and, isNull } from "drizzle-orm"
import { PurchaseOrder } from "../../db/schema/purchaseOrder.ts"
import { PurchaseOrderItem } from "../../db/schema/purchaseOrderItem.ts"
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
  }>
}

/**
 * Match an invoice to an existing Purchase Order.
 *
 * Priority:
 * 1. PO number reference from invoice
 * 2. Supplier + ORDERED status + item overlap scoring
 */
export async function matchPurchaseOrder(
  db: typeof dbType,
  tenantId: string,
  extracted: InvoiceExtractionResult,
  matchedSupplierId: string | null,
  matchedProductIds: (string | null)[]
): Promise<POMatchResult> {
  const noMatch: POMatchResult = { purchaseOrderId: null, confidence: 0, poItems: [] }

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
        })),
      }
    }
  }

  // 2. Supplier-scoped ORDERED POs, then fallback to all ORDERED POs
  const validProductIds = matchedProductIds.filter((id): id is string => id !== null)

  // Build candidate list: supplier-scoped first, then all ORDERED POs as fallback
  let candidatePOs = matchedSupplierId
    ? await db.query.PurchaseOrder.findMany({
        where: and(
          eq(PurchaseOrder.supplier_id, matchedSupplierId),
          eq(PurchaseOrder.tenant_id, tenantId),
          eq(PurchaseOrder.status, ORDER_STATUS.ordered),
          isNull(PurchaseOrder.deletedAt)
        ),
        with: { purchaseOrderItems: true },
      })
    : []

  // If no supplier-scoped candidates, search all ORDERED POs for product overlap
  if (candidatePOs.length === 0 && validProductIds.length > 0) {
    candidatePOs = await db.query.PurchaseOrder.findMany({
      where: and(
        eq(PurchaseOrder.tenant_id, tenantId),
        eq(PurchaseOrder.status, ORDER_STATUS.ordered),
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
  poItems: Array<{ poItemId: string; productId: string; qty: number; unitPrice: number | null }>
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
      const qtyDiff = totalInvoiceQty - matchedPoItem.qty
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
