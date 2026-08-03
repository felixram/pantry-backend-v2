import { boolean, index, pgTable, real, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations, sql } from "drizzle-orm"
import { Tenant } from "./tenant.ts"

export const TaxRate = pgTable(
  "tax_rate",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    name: text().notNull(),
    rate: real().notNull(),
    type: varchar("type", { length: 20 }).notNull(), // "purchase", "sales", or "both"
    is_default: boolean("is_default").default(false),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [
    index().on(t.tenant_id),
    index().on(t.type),
    index().on(t.deletedAt),
    uniqueIndex("tax_rate_tenant_name_unique")
      .on(t.tenant_id, t.name)
      .where(sql`"deletedAt" IS NULL`),
  ]
)

export const TaxRateRelations = relations(TaxRate, ({ one }) => ({
  tenant: one(Tenant, {
    fields: [TaxRate.tenant_id],
    references: [Tenant.id],
  }),
}))
