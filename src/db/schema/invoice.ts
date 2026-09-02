import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
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
    // Resend's per-attachment id. One inbound email with N attachments
    // produces N invoice rows sharing resend_email_id but distinct here —
    // this is also the retry-idempotency key for ingestInvoiceAttachments.
    // NULL for manual uploads; "__none__" sentinel for an attachment-less
    // inbound email's single FAILED row.
    resend_attachment_id: text("resend_attachment_id"),
    original_file_url: text("original_file_url"),
    original_file_name: text("original_file_name"),
    original_file_type: text("original_file_type"),
    invoice_number: text("invoice_number"),
    // ISO 4217 code. Resolved at processing time from the extracted
    // document currency, then the matched supplier, then the tenant default.
    currency: varchar("currency", { length: 3 }),
    extracted_data: jsonb("extracted_data"),
    extraction_confidence: real("extraction_confidence"),
    matched_supplier_id: uuid("matched_supplier_id").references(() => Supplier.id),
    matched_purchase_order_id: uuid("matched_purchase_order_id").references(() => PurchaseOrder.id),
    status: varchar("status", { length: 30 })
      .notNull()
      .default(INVOICE_STATUS.pending),
    processing_error: text("processing_error"),
    // How many times an admin has hit "Retry" on this invoice after a
    // FAILED extraction. The invoice detail page surfaces the manual-entry
    // fallback once this reaches 3.
    retry_count: integer("retry_count").notNull().default(0),
    // True when the line items were keyed in by hand (manualEntryInvoice.ts)
    // rather than produced by Gemini extraction.
    manual_entry: boolean("manual_entry").notNull().default(false),
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
    index().on(t.invoice_number),
    // Plain lookup index for "every invoice from this inbound email".
    index("invoice_tenant_email_id_idx").on(t.tenant_id, t.resend_email_id),
    // One row per (email, attachment). NULLS DISTINCT (Postgres default)
    // leaves manual uploads — all three NULL — unconstrained; inbound rows
    // carry all three, so a re-delivered webhook can't duplicate an
    // attachment. Replaces the old (tenant_id, resend_email_id) unique
    // index, which rejected the 2nd+ attachment of a multi-invoice email.
    uniqueIndex("invoice_tenant_email_attachment_unique")
      .on(t.tenant_id, t.resend_email_id, t.resend_attachment_id),
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
