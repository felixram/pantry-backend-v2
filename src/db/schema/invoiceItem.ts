import { boolean, index, pgTable, real, text, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Invoice } from "./invoice.ts"
import { Product } from "./product.ts"
import { PurchaseOrderItem } from "./purchaseOrderItem.ts"
import { TaxRate } from "./taxRate.ts"

export const InvoiceItem = pgTable(
  "invoice_item",
  {
    id,
    invoice_id: uuid("invoice_id")
      .notNull()
      .references(() => Invoice.id, { onDelete: "cascade" }),
    // Extracted fields from AI
    extracted_name: text("extracted_name"),
    extracted_sku: text("extracted_sku"),
    extracted_qty: real("extracted_qty"),
    extracted_unit_price: real("extracted_unit_price"),
    extracted_unit: text("extracted_unit"),
    extracted_line_total: real("extracted_line_total"),
    extracted_discount_percent: real("extracted_discount_percent"),
    is_out_of_stock: boolean("is_out_of_stock").notNull().default(false),
    // Matching results
    matched_product_id: uuid("matched_product_id").references(() => Product.id),
    match_confidence: real("match_confidence"),
    match_method: varchar("match_method", { length: 20 }),
    matched_po_item_id: uuid("matched_po_item_id").references(() => PurchaseOrderItem.id),
    // Discrepancy flags
    has_qty_discrepancy: boolean("has_qty_discrepancy").notNull().default(false),
    has_price_discrepancy: boolean("has_price_discrepancy").notNull().default(false),
    qty_discrepancy_amount: real("qty_discrepancy_amount"),
    price_discrepancy_amount: real("price_discrepancy_amount"),
    // Admin overrides
    confirmed_product_id: uuid("confirmed_product_id").references(() => Product.id),
    confirmed_qty: real("confirmed_qty"),
    confirmed_unit_price: real("confirmed_unit_price"),
    // Tax fields
    is_taxable: boolean("is_taxable").notNull().default(true),
    extracted_tax_amount: real("extracted_tax_amount"),
    confirmed_tax_amount: real("confirmed_tax_amount"),
    // Tax rate matching — mirrors matched_product_id/confirmed_product_id.
    // Gemini only extracts a dollar tax_amount, never a rate; matched_tax_rate_id
    // is the closest configured TaxRate found by effective-rate matching at
    // import time (see taxRateMatcher.ts), confirmed_tax_rate_id is the
    // reviewer's pick/override (including a rate created on the spot).
    matched_tax_rate_id: uuid("matched_tax_rate_id").references(() => TaxRate.id),
    confirmed_tax_rate_id: uuid("confirmed_tax_rate_id").references(() => TaxRate.id),
    // Accuracy tracking (set on confirmation)
    product_match_correct: boolean("product_match_correct"),
    price_extraction_correct: boolean("price_extraction_correct"),
    qty_extraction_correct: boolean("qty_extraction_correct"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index().on(t.invoice_id),
    index().on(t.matched_product_id),
    index().on(t.matched_po_item_id),
  ]
)

export const InvoiceItemRelations = relations(InvoiceItem, ({ one }) => ({
  invoice: one(Invoice, {
    fields: [InvoiceItem.invoice_id],
    references: [Invoice.id],
  }),
  matchedProduct: one(Product, {
    fields: [InvoiceItem.matched_product_id],
    references: [Product.id],
    relationName: "matchedProduct",
  }),
  confirmedProduct: one(Product, {
    fields: [InvoiceItem.confirmed_product_id],
    references: [Product.id],
    relationName: "confirmedProduct",
  }),
  matchedPoItem: one(PurchaseOrderItem, {
    fields: [InvoiceItem.matched_po_item_id],
    references: [PurchaseOrderItem.id],
  }),
  matchedTaxRate: one(TaxRate, {
    fields: [InvoiceItem.matched_tax_rate_id],
    references: [TaxRate.id],
    relationName: "matchedTaxRate",
  }),
  confirmedTaxRate: one(TaxRate, {
    fields: [InvoiceItem.confirmed_tax_rate_id],
    references: [TaxRate.id],
    relationName: "confirmedTaxRate",
  }),
}))
