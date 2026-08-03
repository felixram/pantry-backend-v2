import { integer, pgTable, real, text, uuid } from "drizzle-orm/pg-core"
import { Product } from "./product.ts"
import { createdAt, id } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"

export const ProductVersion = pgTable("product_version", {
  id,
  productId: uuid().references(() => Product.id, { onDelete: "cascade" }),
  versionNumber: integer().notNull(),
  costPrice: real().notNull(),
  costPriceUnit: text(),
  sellingPrice: real(),
  sellingPriceUnit: text(),
  description: text(),
  createdAt,
})

export const productVersionRelationships = relations(
  ProductVersion,
  ({ one }) => ({
    product: one(Product, {
      references: [Product.id],
      fields: [ProductVersion.productId],
    }),
  })
)
