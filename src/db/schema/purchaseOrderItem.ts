import { index, pgTable, real, uuid, text } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { PurchaseOrder } from "./purchaseOrder.ts"
import { Product } from "./product.ts"
import { relations } from "drizzle-orm"

export const PurchaseOrderItem = pgTable(
  "purchase_order_item",
  {
    id,
    purchase_order_id: uuid().references(() => PurchaseOrder.id, {
      onDelete: "cascade",
    }),
    product_id: uuid()
      .references(() => Product.id)
      .notNull(),
    qty: real().notNull(),
    unit_price: real(),
    // Quantity actually received (set during receiving workflow)
    // If null, the order has not been received yet
    // If different from qty, indicates a discrepancy
    received_qty: real(),
    // Notes about receiving discrepancies (if any)
    received_notes: text(),
    // Selected unit type (e.g., "case", "lb", "kg")
    unit: text(),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [index().on(t.purchase_order_id), index().on(t.product_id)]
)

export const PurchaseOrderItemsRelations = relations(
  PurchaseOrderItem,
  ({ one }) => ({
    product: one(Product, {
      fields: [PurchaseOrderItem.product_id],
      references: [Product.id],
    }),
    purchaseOrder: one(PurchaseOrder, {
      fields: [PurchaseOrderItem.purchase_order_id],
      references: [PurchaseOrder.id],
    }),
  })
)
