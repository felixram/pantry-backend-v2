import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { createdAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Tenant } from "./tenant.ts"
import { Supplier } from "./supplier.ts"
import { Product } from "./product.ts"
import { InvoiceItem } from "./invoiceItem.ts"

export const ProductAlias = pgTable(
  "product_alias",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    supplier_id: uuid("supplier_id")
      .notNull()
      .references(() => Supplier.id),
    alias_name: text("alias_name").notNull(),
    product_id: uuid("product_id")
      .notNull()
      .references(() => Product.id),
    source_invoice_item_id: uuid("source_invoice_item_id").references(
      () => InvoiceItem.id
    ),
    use_count: integer("use_count").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("product_alias_tenant_supplier_name_unique").on(
      t.tenant_id,
      t.supplier_id,
      t.alias_name
    ),
  ]
)

export const ProductAliasRelations = relations(ProductAlias, ({ one }) => ({
  tenant: one(Tenant, {
    fields: [ProductAlias.tenant_id],
    references: [Tenant.id],
  }),
  supplier: one(Supplier, {
    fields: [ProductAlias.supplier_id],
    references: [Supplier.id],
  }),
  product: one(Product, {
    fields: [ProductAlias.product_id],
    references: [Product.id],
  }),
  sourceInvoiceItem: one(InvoiceItem, {
    fields: [ProductAlias.source_invoice_item_id],
    references: [InvoiceItem.id],
  }),
}))
