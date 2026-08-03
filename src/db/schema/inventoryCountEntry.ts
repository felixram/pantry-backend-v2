import { index, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "../schemaHelpers.ts";
import { InventoryCountSession } from "./inventoryCountSession.ts";
import { Stock } from "./stock.ts";
import { Product } from "./product.ts";
import { relations } from "drizzle-orm";

export const InventoryCountEntry = pgTable(
  "inventory_count_entry",
  {
    id,
    session_id: uuid("session_id")
      .notNull()
      .references(() => InventoryCountSession.id, { onDelete: "cascade" }),
    stock_id: uuid("stock_id")
      .notNull()
      .references(() => Stock.id, { onDelete: "cascade" }),
    // Denormalized for efficient querying without extra join
    product_id: uuid("product_id")
      .notNull()
      .references(() => Product.id, { onDelete: "cascade" }),
    // Snapshot of stock.qty at session start
    expected_qty: real("expected_qty").notNull(),
    // Null until the employee counts this item (distinct from 0)
    counted_qty: real("counted_qty"),
    // Which unit the counted_qty is expressed in (nullable for legacy rows)
    unit: text("unit"),
    // Manager's adjusted quantity (same unit as counted_qty). Null = accepted as-is.
    reviewed_qty: real("reviewed_qty"),
    // Timestamp of last successful sync from client
    last_synced_at: timestamp("last_synced_at"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index().on(t.session_id),
    index().on(t.stock_id),
    index().on(t.product_id),
  ],
);

export const InventoryCountEntryRelations = relations(
  InventoryCountEntry,
  ({ one }) => ({
    session: one(InventoryCountSession, {
      fields: [InventoryCountEntry.session_id],
      references: [InventoryCountSession.id],
    }),
    stock: one(Stock, {
      fields: [InventoryCountEntry.stock_id],
      references: [Stock.id],
    }),
    product: one(Product, {
      fields: [InventoryCountEntry.product_id],
      references: [Product.id],
    }),
  }),
);
