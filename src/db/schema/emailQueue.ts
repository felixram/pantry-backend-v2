import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { relations } from "drizzle-orm"
import { createdAt, id, updatedAt } from "../schemaHelpers.ts"
import { Tenant } from "./tenant.ts"

// Outbound email waiting room. Callers render a template and INSERT one row
// (services/email/enqueueEmail.ts); a 1s in-process ticker on the api
// service (services/email/emailQueueWorker.ts) claims rows with
// FOR UPDATE SKIP LOCKED and hands them to Resend no faster than the
// provider's per-account request limit. Rows are kept after send/fail for
// observability and pruned by the hourly cron.
export const EmailQueue = pgTable(
  "email_queue",
  {
    id,
    // Nullable: invitations can be sent before a tenant context exists.
    tenant_id: uuid("tenant_id").references(() => Tenant.id),
    // pending | processing | sent | failed | canceled
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    // Lower drains first. Transactional mail (password reset, invite) = 10;
    // fan-out notifications = 50. See types/email.ts EMAIL_PRIORITY.
    priority: integer("priority").notNull().default(50),
    // types/email.ts EMAIL_TYPE value — drives priority + usage metadata.
    email_type: text("email_type").notNull(),
    to_email: text("to_email").notNull(),
    from_email: text("from_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    // Natural key for dedupe, e.g. `INVOICE_RECEIVED:<invoiceId>:<email>`.
    // NULL rows never collide (Postgres treats NULLs as distinct).
    idempotency_key: text("idempotency_key"),
    attempts: integer("attempts").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(5),
    next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when a worker claims the row; cleared on settle. A row stuck in
    // `processing` past a grace window (api died mid-send) is reclaimed.
    locked_at: timestamp("locked_at", { withTimezone: true }),
    locked_by: text("locked_by"),
    provider_message_id: text("provider_message_id"),
    last_error: text("last_error"),
    sent_at: timestamp("sent_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    // The claim query: WHERE status='pending' AND next_attempt_at<=now()
    // ORDER BY priority, created_at.
    index("email_queue_drain_idx")
      .on(t.priority, t.next_attempt_at)
      .where(sql`status = 'pending'`),
    uniqueIndex("email_queue_idempotency_key_idx").on(t.idempotency_key),
    index("email_queue_status_idx").on(t.status),
    index("email_queue_tenant_idx").on(t.tenant_id),
  ]
)

export const emailQueueRelations = relations(EmailQueue, ({ one }) => ({
  tenant: one(Tenant, { fields: [EmailQueue.tenant_id], references: [Tenant.id] }),
}))
