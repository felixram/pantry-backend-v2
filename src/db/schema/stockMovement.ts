import { index, pgTable, real, text, uuid, varchar } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, deletedAt } from "../schemaHelpers.ts";
import { Product } from "./product.ts";
import { Location } from "./location.ts";
import { User } from "./users.ts";
import { Tenant } from "./tenant.ts";
import { relations } from "drizzle-orm";

export const StockMovement = pgTable(
  "stock_movement",
  {
    id,
    product_id: uuid().references(() => Product.id, { onDelete: "no action" }),
    location_id: uuid().references(() => Location.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    change_qty: real().notNull(),
    // Nullable — historical rows predate this column. New writes should
    // always set one of: ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, PO_RECEIVE,
    // COUNT_ADJUSTMENT, INITIAL.
    movement_type: varchar("movement_type", { length: 20 }),
    reason: text(),
    user_id: uuid().references(() => User.id, { onDelete: "set null" }),
    createdAt,
    deletedAt,
  },
  (t) => [index().on(t.product_id), index().on(t.location_id), index().on(t.tenant_id)],
);

export const StockMovementRelations = relations(StockMovement, ({ one }) => ({
  user: one(User, {
    fields: [StockMovement.user_id],
    references: [User.id],
  }),
  products: one(Product, {
    fields: [StockMovement.product_id],
    references: [Product.id],
  }),
  location: one(Location, {
    fields: [StockMovement.location_id],
    references: [Location.id],
  }),
  tenant: one(Tenant, {
    fields: [StockMovement.tenant_id],
    references: [Tenant.id],
  }),
}));
