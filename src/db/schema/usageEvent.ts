import { index, integer, jsonb, pgTable, real, text, uuid } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { createdAt, id } from "../schemaHelpers.ts"
import { Tenant } from "./tenant.ts"

// Append-only ledger, one row per metered call to a paid third-party
// service (Gemini extraction, Resend send, R2 upload). Written by
// src/services/usage/recordUsageEvent.ts — see that file for the quantity
// unit convention per eventType and why costEstimate is nullable.
export const UsageEvent = pgTable(
  "usage_event",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    eventType: text().notNull(),
    quantity: integer().notNull(),
    costEstimate: real(),
    metadata: jsonb(),
    createdAt,
  },
  (t) => [index().on(t.tenant_id), index().on(t.eventType), index().on(t.createdAt)]
)

export const usageEventRelations = relations(UsageEvent, ({ one }) => ({
  tenant: one(Tenant, { fields: [UsageEvent.tenant_id], references: [Tenant.id] }),
}))
