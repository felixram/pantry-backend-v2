import { pgTable, real, unique, uuid, index, text } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt, deletedAt } from "../schemaHelpers.ts";
import { Product } from "./product.ts";
import { Location } from "./location.ts";
import { Tenant } from "./tenant.ts";
import { relations } from "drizzle-orm";

export const Stock = pgTable(
  "stock",
  {
    id,
    location_id: uuid().references(() => Location.id, { onDelete: "cascade" }),
    productId: uuid().references(() => Product.id),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    qty: real().notNull().default(0),
    minimumStockLevel: real(),
    parLevel: real(),
    expectedUsage: real(),
    display_unit: text(),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (Stock) => [
    unique().on(Stock.location_id, Stock.productId),
    index().on(Stock.productId),
    index().on(Stock.location_id),
    index().on(Stock.tenant_id),
  ],
);
export const StockRelations = relations(Stock, ({ one }) => ({
  product: one(Product, {
    fields: [Stock.productId],
    references: [Product.id],
  }),

  location: one(Location, {
    fields: [Stock.location_id],
    references: [Location.id],
  }),

  tenant: one(Tenant, {
    fields: [Stock.tenant_id],
    references: [Tenant.id],
  }),
}));
