/**
 * Backfill script: Process all existing confirmed/applied invoices to:
 * 1. Populate product aliases from historical corrections
 * 2. Set accuracy flags retroactively
 * 3. Build initial supplier profiles
 *
 * Usage: npx tsx src/scripts/backfillAliases.ts
 */
import { eq, and, isNull, sql } from "drizzle-orm"
import { db } from "../db/index.ts"
import { Invoice } from "../db/schema/invoice.ts"
import { InvoiceItem } from "../db/schema/invoiceItem.ts"
import { ProductAlias } from "../db/schema/productAlias.ts"
import { rebuildSupplierProfile } from "../services/invoice/supplierProfileBuilder.ts"

async function backfill() {
  console.log("Starting backfill of product aliases and accuracy flags...")

  // Get all confirmed/applied invoices
  const invoices = await db.query.Invoice.findMany({
    where: and(
      sql`${Invoice.status} IN ('CONFIRMED', 'APPLIED')`,
      isNull(Invoice.deletedAt)
    ),
    with: {
      items: true,
    },
  })

  console.log(`Found ${invoices.length} confirmed/applied invoices`)

  let aliasesCreated = 0
  let accuracyFlagsSet = 0
  const supplierIds = new Set<string>()

  for (const invoice of invoices) {
    const supplierId = invoice.matched_supplier_id
    if (supplierId) {
      supplierIds.add(`${invoice.tenant_id}:${supplierId}`)
    }

    for (const item of invoice.items) {
      const productId = item.confirmed_product_id || item.matched_product_id
      if (!productId) continue

      // Set accuracy flags if not already set
      if (item.product_match_correct == null) {
        const productMatchCorrect =
          !item.confirmed_product_id ||
          item.confirmed_product_id === item.matched_product_id
        const priceExtractionCorrect =
          !item.confirmed_unit_price ||
          (item.extracted_unit_price != null &&
            Math.abs(item.confirmed_unit_price - item.extracted_unit_price) < 0.01)
        const qtyExtractionCorrect =
          !item.confirmed_qty ||
          (item.extracted_qty != null && item.confirmed_qty === item.extracted_qty)

        await db
          .update(InvoiceItem)
          .set({
            product_match_correct: productMatchCorrect,
            price_extraction_correct: priceExtractionCorrect,
            qty_extraction_correct: qtyExtractionCorrect,
          })
          .where(eq(InvoiceItem.id, item.id))

        accuracyFlagsSet++
      }

      // Create alias if human corrected the match
      if (
        supplierId &&
        item.extracted_name &&
        (
          (item.confirmed_product_id && item.confirmed_product_id !== item.matched_product_id) ||
          (!item.matched_product_id && item.confirmed_product_id)
        )
      ) {
        try {
          await db
            .insert(ProductAlias)
            .values({
              tenant_id: invoice.tenant_id,
              supplier_id: supplierId,
              alias_name: item.extracted_name,
              product_id: item.confirmed_product_id!,
              source_invoice_item_id: item.id,
            })
            .onConflictDoUpdate({
              target: [
                ProductAlias.tenant_id,
                ProductAlias.supplier_id,
                ProductAlias.alias_name,
              ],
              set: {
                product_id: item.confirmed_product_id!,
                use_count: sql`${ProductAlias.use_count} + 1`,
              },
            })
          aliasesCreated++
        } catch (error) {
          console.error(
            `Failed to create alias for "${item.extracted_name}":`,
            error
          )
        }
      }
    }
  }

  console.log(`Created/updated ${aliasesCreated} product aliases`)
  console.log(`Set accuracy flags on ${accuracyFlagsSet} invoice items`)

  // Rebuild supplier profiles
  console.log(`Rebuilding profiles for ${supplierIds.size} suppliers...`)
  for (const key of supplierIds) {
    const [tenantId, supplierId] = key.split(":")
    if (!tenantId || !supplierId) continue
    await rebuildSupplierProfile(db as any, tenantId, supplierId)
  }

  console.log("Backfill complete!")
  process.exit(0)
}

backfill().catch((error) => {
  console.error("Backfill failed:", error)
  process.exit(1)
})
