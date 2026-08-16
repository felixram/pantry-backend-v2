import { boolean, index, pgTable, text, varchar } from "drizzle-orm/pg-core"
import { id, createdAt, updatedAt, deletedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"

export const PLANS = {
  free: "FREE",
  pro: "PRO",
  enterprise: "ENTERPRISE",
} as const

export type TenantPlan = (typeof PLANS)[keyof typeof PLANS]

export const Tenant = pgTable(
  "tenant",
  {
    id,
    name: text().notNull(),
    slug: text().notNull().unique(),
    plan: varchar("plan", { length: 20 }).notNull().default(PLANS.free),
    is_demo: boolean("is_demo").notNull().default(false),
    clerk_org_id: text("clerk_org_id").unique(),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [index().on(t.slug), index().on(t.clerk_org_id)]
)

// Relations will be added after other schemas reference Tenant
export const tenantRelations = relations(Tenant, ({ many }) => ({
  // Users, locations, products, etc. will reference this tenant
  // Relations are defined in those schemas pointing back to Tenant
}))
