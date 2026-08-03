import { index, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Tenant } from "./tenant.ts"
import { Supplier } from "./supplier.ts"
import { PurchaseOrder } from "./purchaseOrder.ts"
import { User } from "./users.ts"
import { Location } from "./location.ts"
import { InvoiceItem } from "./invoiceItem.ts"
import { INVOICE_STATUS } from "../../types/invoice.ts"

export const Invoice = pgTable(
  "invoice",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    location_id: uuid("location_id").references(() => Location.id),
    from_email: text("from_email"),
    from_name: text("from_name"),
    subject: text("subject"),
    received_at: timestamp("received_at", { withTimezone: true }),
    resend_message_id: text("resend_message_id"),
    resend_email_id: text("resend_email_id"),
    original_file_url: text("original_file_url"),
    original_file_name: text("original_file_name"),
    original_file_type: text("original_file_type"),
    extracted_data: jsonb("extracted_data"),
    extraction_confidence: real("extraction_confidence"),
    matched_supplier_id: uuid("matched_supplier_id").references(() => Supplier.id),
    matched_purchase_order_id: uuid("matched_purchase_order_id").references(() => PurchaseOrder.id),
    status: varchar("status", { length: 30 })
      .notNull()
      .default(INVOICE_STATUS.pending),
    processing_error: text("processing_error"),
    reviewed_by: uuid("reviewed_by").references(() => User.id),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    review_notes: text("review_notes"),
    subtotal: real("subtotal"),
    tax_amount: real("tax_amount"),
    tax_rate_applied: real("tax_rate_applied"),
    total: real("total"),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [
    index().on(t.tenant_id),
    index().on(t.location_id),
    index().on(t.status),
    index().on(t.matched_supplier_id),
    index().on(t.matched_purchase_order_id),
    uniqueIndex("invoice_tenant_email_id_unique")
      .on(t.tenant_id, t.resend_email_id),
    index().on(t.deletedAt),
  ]
)

export const InvoiceRelations = relations(Invoice, ({ one, many }) => ({
  tenant: one(Tenant, {
    fields: [Invoice.tenant_id],
    references: [Tenant.id],
  }),
  location: one(Location, {
    fields: [Invoice.location_id],
    references: [Location.id],
  }),
  matchedSupplier: one(Supplier, {
    fields: [Invoice.matched_supplier_id],
    references: [Supplier.id],
  }),
  matchedPurchaseOrder: one(PurchaseOrder, {
    fields: [Invoice.matched_purchase_order_id],
    references: [PurchaseOrder.id],
  }),
  reviewedByUser: one(User, {
    fields: [Invoice.reviewed_by],
    references: [User.id],
  }),
  items: many(InvoiceItem),
}))
