import { index, pgTable, real, text, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Product } from "./product.ts"
import { PurchaseOrder } from "./purchaseOrder.ts"
import { Tenant } from "./tenant.ts"

export const Supplier = pgTable(
  "supplier",
  {
    id,
    name: text().notNull(),
    contact_name: text().notNull(),
    phone: text(),
    email: text(),
    address: text(),
    delivery_days: text(),
    minimum_order_amount: real(),
    free_shipping_minimum: real(),
    shipping_fee: real(),
    supplier_type: varchar("supplier_type", { length: 20 })
      .notNull()
      .default("PRIMARY"),
    preferred_order_method: varchar("preferred_order_method", { length: 20 }),
    // ISO 4217 code this supplier bills in. NULL = use the tenant default.
    currency: varchar("currency", { length: 3 }),
    // Reusable order-email body for this supplier, edited from the PO
    // "Email Supplier" dialog. Holds {{placeholders}} (items, po_number,
    // order_date, deliver_to, supplier_contact, sender_name, org_name) that
    // are filled per-PO at send time. NULL = use the built-in default.
    email_template: text("email_template"),
    notes: text(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [index().on(t.name), index().on(t.tenant_id), index().on(t.deletedAt)]
)

export const SupplierRelations = relations(Supplier, ({ many, one }) => ({
  products: many(Product),
  purchaseOrders: many(PurchaseOrder),
  tenant: one(Tenant, {
    fields: [Supplier.tenant_id],
    references: [Tenant.id],
  }),
}))
