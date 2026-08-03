import { boolean, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Tenant } from "./tenant.ts"
import { Supplier } from "./supplier.ts"

export const SupplierInvoiceProfile = pgTable(
  "supplier_invoice_profile",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    supplier_id: uuid("supplier_id")
      .notNull()
      .references(() => Supplier.id),
    total_invoices_processed: integer("total_invoices_processed").notNull().default(0),
    total_items_processed: integer("total_items_processed").notNull().default(0),
    has_discount_column: boolean("has_discount_column"),
    typical_discount_label: text("typical_discount_label"),
    default_tax_behavior: varchar("default_tax_behavior", { length: 20 }),
    food_items_exempt: boolean("food_items_exempt"),
    tax_marker_style: text("tax_marker_style"),
    known_products: jsonb("known_products"),
    prompt_context: text("prompt_context"),
    // Accuracy metrics
    product_match_accuracy: real("product_match_accuracy"),
    price_extraction_accuracy: real("price_extraction_accuracy"),
    qty_extraction_accuracy: real("qty_extraction_accuracy"),
    overall_accuracy: real("overall_accuracy"),
    last_rebuilt_at: timestamp("last_rebuilt_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("supplier_invoice_profile_tenant_supplier_unique").on(
      t.tenant_id,
      t.supplier_id
    ),
  ]
)

export const SupplierInvoiceProfileRelations = relations(
  SupplierInvoiceProfile,
  ({ one }) => ({
    tenant: one(Tenant, {
      fields: [SupplierInvoiceProfile.tenant_id],
      references: [Tenant.id],
    }),
    supplier: one(Supplier, {
      fields: [SupplierInvoiceProfile.supplier_id],
      references: [Supplier.id],
    }),
  })
)
