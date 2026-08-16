import { index, pgTable, text, uuid } from "drizzle-orm/pg-core"
import { createdAt, id } from "../schemaHelpers.ts"
import { User } from "./users.ts"
import { Location } from "./location.ts"
import { Tenant } from "./tenant.ts"
import { relations } from "drizzle-orm"

// Currently written only by userControllers/hardDelete.ts. Hard delete is a
// single irreversible action (unlike Category/Product/Supplier's soft-delete
// + restore-window + purge lifecycle), so there's no "action" column here.
export const UserAudit = pgTable(
  "user_audit",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    // The admin/manager who performed the deletion. Not nullable and no
    // onDelete override (default restrict) — mirrors CategoryAudit.userId:
    // if this actor is later hard-deleted, the FK blocks it (translated into
    // a friendly message by hardDelete.ts's existing handleDbError
    // catch-all). Intentional: you shouldn't be able to erase your own
    // accountability trail by deleting yourself later.
    actorUserId: uuid()
      .references(() => User.id)
      .notNull(),
    // Nullable + ON DELETE SET NULL — the target row is deleted moments
    // after this insert (same transaction), so this nulls out automatically.
    targetUserId: uuid().references(() => User.id, { onDelete: "set null" }),
    // Snapshots so the log still reads sensibly after the target is gone.
    targetEmail: text().notNull(),
    targetName: text().notNull(),
    // Denormalized so a MANAGER's view can be scoped to their own location
    // (mirrors getPendingInvitations/resendInvitation/revokeInvitation)
    // even after the target user row — and its location_id — is gone.
    targetLocationId: uuid().references(() => Location.id, { onDelete: "set null" }),
    reason: text().notNull(),
    createdAt,
  },
  (userAudit) => [
    index().on(userAudit.tenant_id),
    index().on(userAudit.createdAt),
    index().on(userAudit.targetUserId),
    index().on(userAudit.actorUserId),
  ],
)

export const UserAuditRelations = relations(UserAudit, ({ one }) => ({
  target: one(User, {
    fields: [UserAudit.targetUserId],
    references: [User.id],
    relationName: "userAuditTarget",
  }),
  actor: one(User, {
    fields: [UserAudit.actorUserId],
    references: [User.id],
    relationName: "userAuditActor",
  }),
  tenant: one(Tenant, {
    fields: [UserAudit.tenant_id],
    references: [Tenant.id],
  }),
}))
