import {
  boolean,
  index,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { id, createdAt, updatedAt } from "../schemaHelpers.ts"
import { Product } from "./product.ts"
import { Tenant } from "./tenant.ts"
import { relations } from "drizzle-orm"

export const ProductUnitConversion = pgTable(
  "product_unit_conversion",
  {
    id,
    product_id: uuid()
      .notNull()
      .references(() => Product.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    unit_name: text().notNull(),
    conversion_factor: real().notNull().default(1),
    is_base_unit: boolean().notNull().default(false),
    is_purchasable: boolean().notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    index().on(t.product_id),
    index().on(t.tenant_id),
    uniqueIndex().on(t.product_id, t.unit_name),
  ],
)

export const ProductUnitConversionRelations = relations(
  ProductUnitConversion,
  ({ one }) => ({
    product: one(Product, {
      fields: [ProductUnitConversion.product_id],
      references: [Product.id],
    }),
    tenant: one(Tenant, {
      fields: [ProductUnitConversion.tenant_id],
      references: [Tenant.id],
    }),
  }),
)
