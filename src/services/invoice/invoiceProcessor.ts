import { eq, and, isNull } from "drizzle-orm"
import { db } from "../../db/index.ts"
import { Invoice } from "../../db/schema/invoice.ts"
import { InvoiceItem } from "../../db/schema/invoiceItem.ts"
import { Supplier } from "../../db/schema/supplier.ts"
import { SupplierInvoiceProfile } from "../../db/schema/supplierInvoiceProfile.ts"
import { INVOICE_STATUS } from "../../types/invoice.ts"
import { downloadFile } from "../storage/r2Client.ts"
import { extractInvoiceData } from "../ai/geminiService.ts"
import { matchSupplier } from "./supplierMatcher.ts"
import { matchAllProducts } from "./productMatcher.ts"
import { matchPurchaseOrder, calculateItemDiscrepancies } from "./poMatcher.ts"
import type { InvoiceLineForMatching } from "./poMatcher.ts"
import { sendInvoiceReceivedNotification, sendInvoiceAcknowledgmentEmail } from "../email/emailService.ts"
import { logger } from "../../utils/logger.ts"

/**
 * Process an invoice through the full pipeline:
 * 1. Download file from R2
 * 2. Extract data with Gemini AI
 * 3. Match supplier, products, and PO
 * 4. Create invoice items with discrepancy flags
 * 5. Send notification to admin/manager
 */
export async function processInvoice(invoiceId: string, tenantId: string): Promise<void> {
  try {
    // Set status → PROCESSING
    await db
      .update(Invoice)
      .set({ status: INVOICE_STATUS.processing, processing_error: null })
      .where(and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)))

    // Fetch invoice record
    const invoice = await db.query.Invoice.findFirst({
      where: and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)),
    })

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`)
    }

    // 1. Download file from R2
    let fileBuffer: Buffer | null = null
    if (invoice.original_file_url) {
      fileBuffer = await downloadFile(invoice.original_file_url)
    }

    if (!fileBuffer) {
      throw new Error("Failed to download invoice file from storage")
    }

    // 2. Pre-match supplier by email for context injection
    let supplierContext: string | null = null
    if (invoice.from_email) {
      const preMatchedSupplier = await db.query.Supplier.findFirst({
        where: and(
          eq(Supplier.tenant_id, invoice.tenant_id),
          eq(Supplier.email, invoice.from_email),
          isNull(Supplier.deletedAt)
        ),
      })
      if (preMatchedSupplier) {
        const profile = await db.query.SupplierInvoiceProfile.findFirst({
          where: and(
            eq(SupplierInvoiceProfile.tenant_id, invoice.tenant_id),
            eq(SupplierInvoiceProfile.supplier_id, preMatchedSupplier.id)
          ),
        })
        supplierContext = profile?.prompt_context ?? null
      }
    }

    // 3. Extract data with Gemini (with supplier context if available)
    const extracted = await extractInvoiceData(
      fileBuffer,
      invoice.original_file_type || "application/pdf",
      supplierContext
    )

    // Store extracted data + invoice-level tax totals
    await db
      .update(Invoice)
      .set({
        extracted_data: extracted,
        extraction_confidence: extracted.confidence,
        subtotal: extracted.subtotal ?? null,
        tax_amount: extracted.tax ?? null,
        total: extracted.total ?? null,
        status: INVOICE_STATUS.extracted,
      })
      .where(and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)))

    // 4. Match supplier
    const supplierMatch = await matchSupplier(db, invoice.tenant_id, extracted, invoice.from_email)

    await db
      .update(Invoice)
      .set({ matched_supplier_id: supplierMatch.supplierId })
      .where(and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)))

    // 5. Match products
    const productMatches = await matchAllProducts(
      db,
      invoice.tenant_id,
      extracted.items,
      supplierMatch.supplierId
    )

    // 6. Match PO
    const poMatch = await matchPurchaseOrder(
      db,
      invoice.tenant_id,
      extracted,
      supplierMatch.supplierId,
      productMatches.map((m) => m.productId)
    )

    await db
      .update(Invoice)
      .set({ matched_purchase_order_id: poMatch.purchaseOrderId })
      .where(and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)))

    // 7. Create invoice items with matching and discrepancy info
    const linesForMatching: InvoiceLineForMatching[] = extracted.items.map((item, index) => ({
      productId: productMatches[index]!.productId,
      qty: item.quantity,
      unitPrice: item.unit_price,
      discountPercent: item.discount_percent ?? 0,
      isOOS: item.out_of_stock ?? false,
    }))

    const discrepancies = calculateItemDiscrepancies(linesForMatching, poMatch.poItems)

    const invoiceItems = extracted.items.map((item, index) => {
      const productMatch = productMatches[index]!
      const d = discrepancies[index]!

      return {
        invoice_id: invoiceId,
        extracted_name: item.description,
        extracted_sku: item.sku || null,
        extracted_qty: item.quantity,
        extracted_unit_price: item.unit_price,
        extracted_unit: item.unit || null,
        extracted_line_total: item.line_total,
        extracted_discount_percent: item.discount_percent ?? null,
        is_out_of_stock: item.out_of_stock ?? false,
        is_taxable: item.taxable ?? true,
        extracted_tax_amount: item.tax_amount ?? null,
        matched_product_id: productMatch.productId,
        match_confidence: productMatch.confidence,
        match_method: productMatch.method,
        matched_po_item_id: d.matchedPoItemId,
        has_qty_discrepancy: d.hasQtyDiscrepancy,
        has_price_discrepancy: d.hasPriceDiscrepancy,
        qty_discrepancy_amount: d.qtyDiscrepancyAmount,
        price_discrepancy_amount: d.priceDiscrepancyAmount,
      }
    })

    if (invoiceItems.length > 0) {
      await db.insert(InvoiceItem).values(invoiceItems)
    }

    // 8. Determine final status
    const hasUnmatched = productMatches.some((m) => m.productId === null)
    const hasDiscrepancies = invoiceItems.some(
      (item) => item.has_qty_discrepancy || item.has_price_discrepancy
    )

    // Always send to REVIEW — admin must confirm before stock is updated
    const finalStatus = INVOICE_STATUS.review

    await db
      .update(Invoice)
      .set({ status: finalStatus })
      .where(and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)))

    // 9. Send notification
    try {
      await sendInvoiceReceivedNotification({
        tenantId: invoice.tenant_id,
        invoiceId,
        supplierName: extracted.supplier.name,
        invoiceTotal: extracted.total,
        itemCount: extracted.items.length,
        hasUnmatchedItems: hasUnmatched,
        hasDiscrepancies,
        matchedSupplier: supplierMatch.supplierId !== null,
      })
    } catch (emailError) {
      // Don't fail the whole process if notification fails
      logger.error({ error: emailError, invoiceId }, "Failed to send invoice notification")
    }

    // 10. Send acknowledgment back to the sender
    if (invoice.from_email) {
      try {
        await sendInvoiceAcknowledgmentEmail({
          to: invoice.from_email,
          senderName: extracted.supplier.name || invoice.from_name || "there",
          itemCount: extracted.items.length,
          receivedAt: invoice.received_at ?? new Date(),
        })
      } catch (ackError) {
        logger.error({ error: ackError, invoiceId }, "Failed to send invoice acknowledgment to sender")
      }
    }

    logger.info(
      {
        invoiceId,
        status: finalStatus,
        supplierMatch: supplierMatch.method,
        productMatches: productMatches.length,
        unmatchedProducts: productMatches.filter((m) => !m.productId).length,
        poMatch: poMatch.purchaseOrderId ? "matched" : "none",
        discrepancies: hasDiscrepancies,
      },
      "Invoice processing complete"
    )
  } catch (error) {
    logger.error({ error, invoiceId }, "Invoice processing failed")

    // Tenant-scoped even though every current caller pre-verifies ownership
    // before invoking this function — this is the one write in the file that
    // runs even when that upstream check has already failed (e.g. invoiceId
    // belongs to a different tenant), so without the filter here a future
    // caller that skips the pre-check would corrupt another tenant's invoice.
    await db
      .update(Invoice)
      .set({
        status: INVOICE_STATUS.failed,
        processing_error: error instanceof Error ? error.message : String(error),
      })
      .where(and(eq(Invoice.id, invoiceId), eq(Invoice.tenant_id, tenantId)))
  }
}
