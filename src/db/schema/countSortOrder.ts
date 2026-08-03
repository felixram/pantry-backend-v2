import { boolean, index, integer, pgTable, unique, uuid } from "drizzle-orm/pg-core"
import { id, createdAt, updatedAt } from "../schemaHelpers.ts"
import { Tenant } from "./tenant.ts"
import { Location } from "./location.ts"
import { Category } from "./category.ts"
import { Product } from "./product.ts"
import { relations } from "drizzle-orm"

export const CountSortOrder = pgTable(
  "count_sort_order",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    location_id: uuid("location_id")
      .notNull()
      .references(() => Location.id, { onDelete: "cascade" }),
    category_id: uuid("category_id")
      .notNull()
      .references(() => Category.id, { onDelete: "cascade" }),
    // NULL = category-level ordering, non-NULL = product-within-category ordering
    product_id: uuid("product_id").references(() => Product.id, {
      onDelete: "cascade",
    }),
    sort_order: integer("sort_order").notNull().default(0),
    // When true, this product is excluded from the count list
    excluded: boolean("excluded").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique().on(t.tenant_id, t.location_id, t.category_id, t.product_id),
    index().on(t.tenant_id, t.location_id),
    index().on(t.category_id),
    index().on(t.product_id),
  ]
)

export const countSortOrderRelations = relations(CountSortOrder, ({ one }) => ({
  tenant: one(Tenant, {
    fields: [CountSortOrder.tenant_id],
    references: [Tenant.id],
  }),
  location: one(Location, {
    fields: [CountSortOrder.location_id],
    references: [Location.id],
  }),
  category: one(Category, {
    fields: [CountSortOrder.category_id],
    references: [Category.id],
  }),
  product: one(Product, {
    fields: [CountSortOrder.product_id],
    references: [Product.id],
  }),
}))
