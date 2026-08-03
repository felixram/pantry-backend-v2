import { pgTable, text, uuid } from "drizzle-orm/pg-core"
import { createdAt, id } from "../schemaHelpers.ts"
import { PurchaseOrder } from "./purchaseOrder.ts"
import { User } from "./users.ts"
import { relations } from "drizzle-orm"

export const PurchaseOrderAudit = pgTable("purchase_order_audit", {
  id,
  purchaseOrderId: uuid()
    .references(() => PurchaseOrder.id)
    .notNull(),
  userId: uuid()
    .references(() => User.id)
    .notNull(),
  fieldChanged: text().notNull(),
  oldValue: text().notNull(),
  newValue: text().notNull(),
  reason: text().notNull(),
  createdAt,
})

export const purchaseOrderAuditRelations = relations(
  PurchaseOrderAudit,
  ({ one }) => ({
    user: one(User, {
      fields: [PurchaseOrderAudit.userId],
      references: [User.id],
    }),
    purchaseOrder: one(PurchaseOrder, {
      fields: [PurchaseOrderAudit.purchaseOrderId],
      references: [PurchaseOrder.id],
    }),
  })
)
