import { index, pgTable, text, uuid } from "drizzle-orm/pg-core"
import { createdAt, id } from "../schemaHelpers.ts"
import { Location } from "./location.ts"
import { Tenant } from "./tenant.ts"
import { User } from "./users.ts"
import { relations } from "drizzle-orm"

export const LocationAudit = pgTable(
  "location_audit",
  {
    id,
    // Nullable + ON DELETE SET NULL — mirrors CategoryAudit.categoryId. No
    // purge cron exists for locations (see restoreLocationProcedure's own
    // comment on why restore has no time window), so in practice this only
    // ever goes null if a location is ever hard-deleted by some future path.
    locationId: uuid().references(() => Location.id, { onDelete: "set null" }),
    // Snapshot so the log still reads sensibly if that ever happens.
    locationName: text().notNull(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    action: text().notNull(), // "deleted" | "restored"
    userId: uuid()
      .references(() => User.id)
      .notNull(),
    reason: text(),
    createdAt,
  },
  (locationAudit) => [
    index().on(locationAudit.locationId),
    index().on(locationAudit.tenant_id),
    index().on(locationAudit.createdAt),
  ],
)

export const LocationAuditRelations = relations(LocationAudit, ({ one }) => ({
  location: one(Location, {
    fields: [LocationAudit.locationId],
    references: [Location.id],
  }),
  user: one(User, {
    fields: [LocationAudit.userId],
    references: [User.id],
  }),
  tenant: one(Tenant, {
    fields: [LocationAudit.tenant_id],
    references: [Tenant.id],
  }),
}))
