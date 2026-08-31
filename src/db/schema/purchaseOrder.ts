import { boolean, index, pgTable, real, timestamp, uuid, varchar, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { Supplier } from "./supplier.ts"
import { Location } from "./location.ts"
import { User } from "./users.ts"
import { Tenant } from "./tenant.ts"
import { InventoryCountSession } from "./inventoryCountSession.ts"
import { relations } from "drizzle-orm"
import { PurchaseOrderItem } from "./purchaseOrderItem.ts"
import { ORDER_STATUS } from "../../types/orders.ts"

export const PurchaseOrder = pgTable(
  "purchase_order",
  {
    id,
    po_number: varchar("po_number", { length: 20 }).notNull(),
    supplier_id: uuid().references(() => Supplier.id),
    destination_location_id: uuid().references(() => Location.id),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    status: varchar("status", { length: 20 })
      .notNull()
      .default(ORDER_STATUS.draft),
    subtotal: real("subtotal"),
    tax_amount: real("tax_amount"),
    total: real("total"),
    // ISO 4217 code, snapshotted from the supplier (or tenant default) when
    // the PO is created. NULL on legacy rows = tenant default.
    currency: varchar("currency", { length: 3 }),
    is_unlocked: boolean("is_unlocked").notNull().default(false),
    unlocked_by: uuid("unlocked_by").references(() => User.id),
    unlocked_at: timestamp("unlocked_at", { withTimezone: true }),
    // Set only for POs created via the "Suggested POs" flow off an approved
    // inventory count — lets createSuggestedPOs check per-supplier whether
    // this session already produced an order for a given supplier, instead
    // of relying on a single all-or-nothing session-level flag.
    source_count_session_id: uuid("source_count_session_id").references(() => InventoryCountSession.id),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [
    index().on(t.supplier_id),
    index().on(t.status),
    index().on(t.createdAt),
    index().on(t.po_number),
    index().on(t.tenant_id),
    uniqueIndex("purchase_order_po_number_tenant_unique").on(t.po_number, t.tenant_id),
    index().on(t.deletedAt),
    index().on(t.source_count_session_id),
  ]
)

export const PurchaseOrderRelations = relations(
  PurchaseOrder,
  ({ one, many }) => ({
    supplier: one(Supplier, {
      fields: [PurchaseOrder.supplier_id],
      references: [Supplier.id],
    }),
    destinationLocation: one(Location, {
      fields: [PurchaseOrder.destination_location_id],
      references: [Location.id],
    }),
    unlockedByUser: one(User, {
      fields: [PurchaseOrder.unlocked_by],
      references: [User.id],
    }),
    tenant: one(Tenant, {
      fields: [PurchaseOrder.tenant_id],
      references: [Tenant.id],
    }),
    sourceCountSession: one(InventoryCountSession, {
      fields: [PurchaseOrder.source_count_session_id],
      references: [InventoryCountSession.id],
    }),
    purchaseOrderItems: many(PurchaseOrderItem),
  })
)
