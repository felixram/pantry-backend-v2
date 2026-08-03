import { index, integer, pgTable, unique, uuid } from "drizzle-orm/pg-core"
import { createdAt, id, updatedAt } from "../schemaHelpers.ts"
import { Tenant } from "./tenant.ts"
import { relations } from "drizzle-orm"

export const POCounter = pgTable(
  "po_counter",
  {
    id,
    year: integer("year").notNull(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    last_sequence: integer("last_sequence").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique().on(t.year, t.tenant_id), // Each tenant has independent PO number sequence per year
    index().on(t.tenant_id),
  ]
)

export const POCounterRelations = relations(POCounter, ({ one }) => ({
  tenant: one(Tenant, {
    fields: [POCounter.tenant_id],
    references: [Tenant.id],
  }),
}))
