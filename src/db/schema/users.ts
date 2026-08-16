import { index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"
import { id, createdAt, updatedAt, deletedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { StockMovement } from "./stockMovement.ts"
import { Location } from "./location.ts"
import { Tenant } from "./tenant.ts"
import { ROLES, STATUS } from "../../types/user.ts"

export const User = pgTable(
  "user",
  {
    id,
    name: text().notNull(),
    last_name: text().notNull(),
    email: text().notNull(),
    // role/name/last_name/email are a webhook-synced read mirror of Clerk —
    // Clerk (via clerk_user_id / org membership) is the write source of
    // truth; kept locally for SQL-level joins/filters and so ctx.user.id
    // can stay this row's own uuid instead of the Clerk user id.
    role: varchar("role", { length: 20 }).notNull().default(ROLES.user),
    status: varchar("status", { length: 20 }).notNull().default(STATUS.active),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    location_id: uuid("location_id"), // FK to location table, nullable for admins
    clerk_user_id: text("clerk_user_id").unique(),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [
    index().on(t.email),
    index().on(t.role),
    index().on(t.location_id),
    index().on(t.tenant_id),
    index().on(t.clerk_user_id),
  ]
)

export const userRelations = relations(User, ({ many, one }) => ({
  stockMovement: many(StockMovement),
  location: one(Location, {
    fields: [User.location_id],
    references: [Location.id],
  }),
  tenant: one(Tenant, {
    fields: [User.tenant_id],
    references: [Tenant.id],
  }),
}))
