import { index, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt } from "../schemaHelpers.ts";
import { Location } from "./location.ts";
import { User } from "./users.ts";
import { Tenant } from "./tenant.ts";
import { relations } from "drizzle-orm";
import { InventoryCountEntry } from "./inventoryCountEntry.ts";

export const INVENTORY_COUNT_STATUS = {
  active: "ACTIVE",
  pending_review: "PENDING_REVIEW",
  completed: "COMPLETED",
} as const;

export const InventoryCountSession = pgTable(
  "inventory_count_session",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    location_id: uuid("location_id")
      .notNull()
      .references(() => Location.id),
    created_by: uuid("created_by")
      .notNull()
      .references(() => User.id),
    status: varchar("status", { length: 20 })
      .notNull()
      .default(INVENTORY_COUNT_STATUS.active),
    // ISO week string e.g. "2026-W08"
    week_identifier: varchar("week_identifier", { length: 10 }).notNull(),
    submitted_at: timestamp("submitted_at"),
    completed_at: timestamp("completed_at"),
    completed_by: uuid("completed_by").references(() => User.id),
    reviewed_by: uuid("reviewed_by").references(() => User.id),
    suggested_pos_created_at: timestamp("suggested_pos_created_at"),
    // Reject trail — a rejected session isn't a new/terminal status, it's
    // sent back to ACTIVE (see rejectCount.ts) with these stamped for audit
    // and so the counter's UI can show why it came back.
    rejected_at: timestamp("rejected_at"),
    rejected_by: uuid("rejected_by").references(() => User.id),
    rejection_reason: text("rejection_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique().on(t.tenant_id, t.location_id, t.week_identifier),
    index().on(t.tenant_id),
    index().on(t.location_id),
    index().on(t.week_identifier),
    index().on(t.status),
  ],
);

export const InventoryCountSessionRelations = relations(
  InventoryCountSession,
  ({ one, many }) => ({
    tenant: one(Tenant, {
      fields: [InventoryCountSession.tenant_id],
      references: [Tenant.id],
    }),
    location: one(Location, {
      fields: [InventoryCountSession.location_id],
      references: [Location.id],
    }),
    createdByUser: one(User, {
      fields: [InventoryCountSession.created_by],
      references: [User.id],
      relationName: "sessionCreator",
    }),
    completedByUser: one(User, {
      fields: [InventoryCountSession.completed_by],
      references: [User.id],
      relationName: "sessionCompleter",
    }),
    reviewedByUser: one(User, {
      fields: [InventoryCountSession.reviewed_by],
      references: [User.id],
      relationName: "sessionReviewer",
    }),
    rejectedByUser: one(User, {
      fields: [InventoryCountSession.rejected_by],
      references: [User.id],
      relationName: "sessionRejecter",
    }),
    entries: many(InventoryCountEntry),
  }),
);

