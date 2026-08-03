import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core"
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
    password: text().notNull(),
    role: varchar("role", { length: 20 }).notNull().default(ROLES.user),
    status: varchar("status", { length: 20 }).notNull().default(STATUS.active),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    location_id: uuid("location_id"), // FK to location table, nullable for admins
    invitation_token: text("invitation_token").unique(),
    invitation_expires_at: timestamp("invitation_expires_at"),
    password_reset_token: text("password_reset_token").unique(),
    password_reset_expires_at: timestamp("password_reset_expires_at"),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (t) => [
    index().on(t.email),
    index().on(t.role),
    index().on(t.location_id),
    index().on(t.tenant_id),
    index().on(t.invitation_token),
    index().on(t.password_reset_token),
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
