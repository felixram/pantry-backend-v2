import { eq, and, desc, sql, isNull } from "drizzle-orm"
import { Invoice } from "../../db/schema/invoice.ts"
import { InvoiceItem } from "../../db/schema/invoiceItem.ts"
import { SupplierInvoiceProfile } from "../../db/schema/supplierInvoiceProfile.ts"
import { INVOICE_STATUS } from "../../types/invoice.ts"
import { logger } from "../../utils/logger.ts"
import type { db as dbType } from "../../db/index.ts"

interface KnownProduct {
  name: string
  sku: string | null
  product_id: string
  frequency: number
}

/**
 * Rebuild the supplier invoice profile from confirmed invoice history.
 * Aggregates tax patterns, discount patterns, top products, accuracy metrics,
 * and generates a prompt_context string for Gemini injection.
 */
export async function rebuildSupplierProfile(
  tx: typeof dbType,
  tenantId: string,
  supplierId: string
): Promise<void> {
  try {
    // Get last 20 confirmed/applied invoices for this supplier
    const recentInvoices = await tx.query.Invoice.findMany({
      where: and(
        eq(Invoice.tenant_id, tenantId),
        eq(Invoice.matched_supplier_id, supplierId),
        sql`${Invoice.status} IN ('CONFIRMED', 'APPLIED')`,
        isNull(Invoice.deletedAt)
      ),
      with: {
        items: {
          with: {
            confirmedProduct: true,
            matchedProduct: true,
          },
        },
      },
      orderBy: [desc(Invoice.reviewed_at)],
      limit: 20,
    })

    if (recentInvoices.length === 0) return

    // Aggregate all items
    const allItems = recentInvoices.flatMap((inv) => inv.items)
    const totalInvoices = recentInvoices.length
    const totalItems = allItems.length

    // --- Tax pattern analysis ---
    const taxableCount = allItems.filter((i) => i.is_taxable).length
    const nonTaxableCount = allItems.filter((i) => !i.is_taxable).length
    let defaultTaxBehavior: string
    if (taxableCount === 0) {
      defaultTaxBehavior = "all_exempt"
    } else if (nonTaxableCount === 0) {
      defaultTaxBehavior = "all_taxable"
    } else if (taxableCount > 0 && nonTaxableCount > 0) {
      defaultTaxBehavior = "mixed"
    } else {
      defaultTaxBehavior = "unknown"
    }

    // Check if food items tend to be exempt (simple heuristic)
    let foodItemsExempt: boolean | null = null
    if (defaultTaxBehavior === "mixed") {
      // Simple heuristic: if non-taxable items exist alongside taxable ones, likely food exempt pattern
      foodItemsExempt = true
    }

    // --- Discount pattern analysis ---
    const itemsWithDiscount = allItems.filter(
      (i) => i.extracted_discount_percent != null && i.extracted_discount_percent > 0
    )
    const hasDiscountColumn = itemsWithDiscount.length > totalItems * 0.1 // >10% of items have discounts

    // --- Known products (top 50 by frequency) ---
    const productFrequency = new Map<
      string,
      { name: string; sku: string | null; product_id: string; count: number }
    >()

    for (const item of allItems) {
      const product = item.confirmedProduct ?? item.matchedProduct
      if (!product) continue

      const existing = productFrequency.get(product.id)
      if (existing) {
        existing.count++
      } else {
        productFrequency.set(product.id, {
          name: product.name,
          sku: product.sku,
          product_id: product.id,
          count: 1,
        })
      }
    }

    const knownProducts: KnownProduct[] = Array.from(productFrequency.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map((p) => ({
        name: p.name,
        sku: p.sku,
        product_id: p.product_id,
        frequency: p.count,
      }))

    // --- Accuracy metrics ---
    const itemsWithMatchAccuracy = allItems.filter(
      (i) => i.product_match_correct != null
    )
    const itemsWithPriceAccuracy = allItems.filter(
      (i) => i.price_extraction_correct != null
    )
    const itemsWithQtyAccuracy = allItems.filter(
      (i) => i.qty_extraction_correct != null
    )

    const productMatchAccuracy =
      itemsWithMatchAccuracy.length > 0
        ? itemsWithMatchAccuracy.filter((i) => i.product_match_correct).length /
          itemsWithMatchAccuracy.length
        : null

    const priceExtractionAccuracy =
      itemsWithPriceAccuracy.length > 0
        ? itemsWithPriceAccuracy.filter((i) => i.price_extraction_correct).length /
          itemsWithPriceAccuracy.length
        : null

    const qtyExtractionAccuracy =
      itemsWithQtyAccuracy.length > 0
        ? itemsWithQtyAccuracy.filter((i) => i.qty_extraction_correct).length /
          itemsWithQtyAccuracy.length
        : null

    const accuracyValues = [
      productMatchAccuracy,
      priceExtractionAccuracy,
      qtyExtractionAccuracy,
    ].filter((v): v is number => v != null)

    const overallAccuracy =
      accuracyValues.length > 0
        ? accuracyValues.reduce((sum, v) => sum + v, 0) / accuracyValues.length
        : null

    // --- Build prompt context (~500 tokens cap) ---
    // Get supplier name from first invoice's supplier relation
    const supplierName =
      recentInvoices[0]?.items[0]?.confirmedProduct?.name
        ? "this supplier"
        : "this supplier"

    // Try to get supplier name from the invoice data
    let supplierDisplayName = "this supplier"
    for (const inv of recentInvoices) {
      const extractedData = inv.extracted_data as { supplier?: { name?: string } } | null
      if (extractedData?.supplier?.name) {
        supplierDisplayName = extractedData.supplier.name
        break
      }
    }

    const contextParts: string[] = []
    contextParts.push(`SUPPLIER CONTEXT (${supplierDisplayName}):`)

    if (hasDiscountColumn) {
      contextParts.push(
        `- This supplier uses a discount column. Discounts are common on items.`
      )
    }

    if (defaultTaxBehavior === "all_exempt") {
      contextParts.push(`- All items from this supplier are typically NOT taxable.`)
    } else if (defaultTaxBehavior === "all_taxable") {
      contextParts.push(`- All items from this supplier are typically taxable.`)
    } else if (defaultTaxBehavior === "mixed" && foodItemsExempt) {
      contextParts.push(
        `- Non-food items (plates, bowls, utensils, supplies) are TAXABLE; food items are NOT taxable.`
      )
    }

    // Add top known products (limit to keep under ~500 tokens)
    if (knownProducts.length > 0) {
      const productList = knownProducts
        .slice(0, 20)
        .map((p) => {
          const skuPart = p.sku ? ` (SKU:${p.sku})` : ""
          return `${p.name}${skuPart}`
        })
        .join(", ")
      contextParts.push(`- Known products: ${productList}`)
    }

    const promptContext = contextParts.join("\n")

    // --- Upsert profile ---
    await tx
      .insert(SupplierInvoiceProfile)
      .values({
        tenant_id: tenantId,
        supplier_id: supplierId,
        total_invoices_processed: totalInvoices,
        total_items_processed: totalItems,
        has_discount_column: hasDiscountColumn,
        default_tax_behavior: defaultTaxBehavior,
        food_items_exempt: foodItemsExempt,
        known_products: knownProducts,
        prompt_context: promptContext,
        product_match_accuracy: productMatchAccuracy,
        price_extraction_accuracy: priceExtractionAccuracy,
        qty_extraction_accuracy: qtyExtractionAccuracy,
        overall_accuracy: overallAccuracy,
        last_rebuilt_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          SupplierInvoiceProfile.tenant_id,
          SupplierInvoiceProfile.supplier_id,
        ],
        set: {
          total_invoices_processed: totalInvoices,
          total_items_processed: totalItems,
          has_discount_column: hasDiscountColumn,
          default_tax_behavior: defaultTaxBehavior,
          food_items_exempt: foodItemsExempt,
          known_products: knownProducts,
          prompt_context: promptContext,
          product_match_accuracy: productMatchAccuracy,
          price_extraction_accuracy: priceExtractionAccuracy,
          qty_extraction_accuracy: qtyExtractionAccuracy,
          overall_accuracy: overallAccuracy,
          last_rebuilt_at: new Date(),
        },
      })

    logger.info(
      {
        supplierId,
        totalInvoices,
        totalItems,
        knownProducts: knownProducts.length,
        productMatchAccuracy,
        overallAccuracy,
      },
      "Supplier invoice profile rebuilt"
    )
  } catch (error) {
    logger.error(
      { error, supplierId, tenantId },
      "Failed to rebuild supplier profile"
    )
  }
}
