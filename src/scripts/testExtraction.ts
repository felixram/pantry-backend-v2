import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import { extractInvoiceData } from "../services/ai/geminiService.ts"

dotenv.config()

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error("Usage: npx tsx src/scripts/testExtraction.ts <path-to-invoice>")
    process.exit(1)
  }

  const resolved = path.resolve(filePath)
  console.log(`Reading: ${resolved}`)

  const buffer = fs.readFileSync(resolved)
  const ext = path.extname(resolved).toLowerCase()
  const mimeType =
    ext === ".pdf" ? "application/pdf" :
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    "application/pdf"

  console.log(`MIME: ${mimeType}, Size: ${(buffer.length / 1024).toFixed(1)} KB`)
  console.log("Extracting...\n")

  const result = await extractInvoiceData(buffer, mimeType)

  console.log("=== SUPPLIER ===")
  console.log(result.supplier)

  console.log("\n=== INVOICE INFO ===")
  console.log(`  Number: ${result.invoice_number}`)
  console.log(`  Date: ${result.invoice_date}`)
  console.log(`  Due: ${result.due_date}`)
  console.log(`  PO Ref: ${result.po_reference}`)

  console.log("\n=== ITEMS ===")
  for (const item of result.items) {
    const oos = item.out_of_stock ? " [OUT OF STOCK]" : ""
    const tax = item.taxable === false ? " [NT]" : item.taxable === true ? " [TAXABLE]" : ""
    const taxAmt = item.tax_amount != null ? ` tax=$${item.tax_amount}` : ""
    const disc = item.discount_percent ? ` [DSC: ${item.discount_percent}%]` : ""
    console.log(`  - ${item.description}${oos}${tax}${disc}${taxAmt}`)
    const expected = item.quantity * item.unit_price
    const mismatch = Math.abs(expected - item.line_total) > 0.02 && !item.discount_percent ? " ⚠️ MISMATCH" : ""
    console.log(`    SKU: ${item.sku ?? "—"} | Qty: ${item.quantity} ${item.unit ?? ""} | Price: $${item.unit_price} | Total: $${item.line_total}${mismatch}`)
  }

  console.log("\n=== TOTALS ===")
  console.log(`  Subtotal: $${result.subtotal}`)
  console.log(`  Tax: $${result.tax}`)
  console.log(`  Total: $${result.total}`)
  console.log(`  Currency: ${result.currency}`)
  console.log(`  Confidence: ${result.confidence}`)

  const oosItems = result.items.filter((i) => i.out_of_stock)
  console.log(`\n=== OUT OF STOCK: ${oosItems.length} item(s) ===`)
  for (const item of oosItems) {
    console.log(`  - ${item.description}`)
  }
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
