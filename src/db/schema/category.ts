import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Product } from "./product.ts"
import { Tenant } from "./tenant.ts"
import { TaxRate } from "./taxRate.ts"

export const Category = pgTable(
  "category",
  {
    id,
    name: text().notNull(),
    description: text(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    tax_rate_id: uuid("tax_rate_id").references(() => TaxRate.id),
    is_tax_exempt: boolean("is_tax_exempt").default(false),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (cat) => [index().on(cat.name), index().on(cat.tenant_id), index().on(cat.deletedAt)]
)

export const CategoryRelations = relations(Category, ({ many, one }) => ({
  products: many(Product),
  tenant: one(Tenant, {
    fields: [Category.tenant_id],
    references: [Tenant.id],
  }),
  taxRate: one(TaxRate, {
    fields: [Category.tax_rate_id],
    references: [TaxRate.id],
  }),
}))
