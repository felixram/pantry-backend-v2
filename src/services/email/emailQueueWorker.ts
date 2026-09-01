import os from "node:os"
import { eq, sql } from "drizzle-orm"
import type { Resend } from "resend"
import { db } from "../../db/index.ts"
import { EmailQueue } from "../../db/schema/emailQueue.ts"
import { getResendClient } from "./resendClient.ts"
import { recordUsageEvent } from "../usage/recordUsageEvent.ts"
import { USAGE_EVENT_TYPE } from "../../types/usage.ts"
import { logger } from "../../utils/logger.ts"

// Provider request ceiling. Each tick claims at most this many rows and
// sends them concurrently, so concurrent requests never exceed the limit
// Resend enforces on the account. Bump via env once the plan allows more.
const RATE_PER_SEC = clampInt(process.env.EMAIL_RATE_LIMIT_PER_SEC, 2, 1, 100)
// A row still `processing` this long after being claimed = the api died
// mid-send. Reclaimed on the next tick (and by the hourly cron sweep).
const STUCK_AFTER_MINUTES = 5
const INSTANCE_ID = `${os.hostname()}:${process.pid}`

// Resend error `name`s where retrying the same payload can never succeed —
// straight to `failed`, no backoff. Everything else (429, 5xx, thrown
// network errors, unknown) is retried until max_attempts.
const PERMANENT_ERROR_NAMES = new Set([
  "validation_error",
  "invalid_from_address",
  "invalid_to_address",
  "missing_required_field",
  "invalid_parameter",
  "restricted_api_key",
  "invalid_api_key",
  "not_found",
])

export interface ClaimedEmailRow {
  id: string
  tenant_id: string | null
  email_type: string
  to_email: string
  from_email: string
  subject: string
  html: string
  text: string
  attempts: number
  max_attempts: number
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** Move rows abandoned in `processing` back to `pending` so they retry. */
export async function sweepStuckEmails(): Promise<number> {
  const rows = await db.execute(sql`
    UPDATE email_queue
       SET status = 'pending', locked_at = NULL, locked_by = NULL, "updatedAt" = now()
     WHERE status = 'processing'
       AND locked_at < now() - (${STUCK_AFTER_MINUTES} * interval '1 minute')
    RETURNING id
  `)
  return (rows as unknown as unknown[]).length
}

// Settled rows are kept this long for observability, then pruned.
const KEEP_SETTLED_DAYS = 30

/** Delete sent/failed/canceled rows older than the retention window. */
export async function pruneSettledEmails(): Promise<number> {
  const rows = await db.execute(sql`
    DELETE FROM email_queue
     WHERE status IN ('sent', 'failed', 'canceled')
       AND "updatedAt" < now() - (${KEEP_SETTLED_DAYS} * interval '1 day')
    RETURNING id
  `)
  return (rows as unknown as unknown[]).length
}

/** Cron entry point: reclaim stuck rows + prune old settled ones. */
export async function sweepEmailQueue(): Promise<{ reclaimed: number; pruned: number }> {
  const reclaimed = await sweepStuckEmails()
  const pruned = await pruneSettledEmails()
  return { reclaimed, pruned }
}

/**
 * Atomically claim up to `limit` due rows: pick the highest-priority
 * pending rows whose next_attempt_at has passed, skipping any a
 * concurrent worker already holds, and flip them to `processing`.
 */
export async function claimDueEmails(limit: number): Promise<ClaimedEmailRow[]> {
  const rows = await db.execute(sql`
    WITH claimed AS (
      SELECT id FROM email_queue
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY priority ASC, "createdAt" ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE email_queue q
       SET status = 'processing',
           locked_at = now(),
           locked_by = ${INSTANCE_ID},
           attempts = q.attempts + 1,
           "updatedAt" = now()
      FROM claimed
     WHERE q.id = claimed.id
    RETURNING q.id, q.tenant_id, q.email_type, q.to_email, q.from_email,
              q.subject, q.html, q.text, q.attempts, q.max_attempts
  `)
  return rows as unknown as ClaimedEmailRow[]
}

async function markSent(row: ClaimedEmailRow, messageId: string | null): Promise<void> {
  await db
    .update(EmailQueue)
    .set({
      status: "sent",
      sent_at: new Date(),
      provider_message_id: messageId,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updatedAt: new Date(),
    })
    .where(eq(EmailQueue.id, row.id))

  if (row.tenant_id) {
    await recordUsageEvent({
      tenantId: row.tenant_id,
      eventType: USAGE_EVENT_TYPE.email_sent,
      quantity: 1,
      metadata: { kind: row.email_type, messageId, queueId: row.id },
    })
  }
}

function backoffMs(attempts: number): number {
  const base = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1))
  return base + Math.floor(Math.random() * 5_000)
}

async function handleFailure(
  row: ClaimedEmailRow,
  errName: string,
  errMessage: string,
  statusCode?: number | null
): Promise<void> {
  const permanent =
    PERMANENT_ERROR_NAMES.has(errName) ||
    (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 && statusCode !== 429 && statusCode !== 408)
  const exhausted = row.attempts >= row.max_attempts
  const summary = `${errName}: ${errMessage}`.slice(0, 500)

  if (permanent || exhausted) {
    await db
      .update(EmailQueue)
      .set({ status: "failed", last_error: summary, locked_at: null, locked_by: null, updatedAt: new Date() })
      .where(eq(EmailQueue.id, row.id))
    logger.warn(
      { queueId: row.id, to: row.to_email, emailType: row.email_type, errName, permanent, attempts: row.attempts },
      "email permanently failed"
    )
    if (row.tenant_id) {
      await recordUsageEvent({
        tenantId: row.tenant_id,
        eventType: USAGE_EVENT_TYPE.email_failed,
        quantity: 1,
        metadata: { kind: row.email_type, error: summary.slice(0, 200), queueId: row.id, permanent },
      })
    }
    return
  }

  const delay = backoffMs(row.attempts)
  await db
    .update(EmailQueue)
    .set({
      status: "pending",
      next_attempt_at: new Date(Date.now() + delay),
      last_error: summary,
      locked_at: null,
      locked_by: null,
      updatedAt: new Date(),
    })
    .where(eq(EmailQueue.id, row.id))
  logger.info(
    { queueId: row.id, attempt: row.attempts, retryInMs: delay, errName },
    "email send failed — will retry"
  )
}

/** Send one already-claimed row and record its outcome. Never throws. */
export async function processClaimedEmail(row: ClaimedEmailRow, resend: Resend | null): Promise<void> {
  if (!resend) {
    // No API key (local dev / CI): resolve the row so the queue drains, but
    // don't meter — nothing was actually sent.
    logger.info({ to: row.to_email, emailType: row.email_type }, "email (dev mode — RESEND_API_KEY unset, not sent)")
    await db
      .update(EmailQueue)
      .set({
        status: "sent",
        sent_at: new Date(),
        provider_message_id: "dev-mode",
        locked_at: null,
        locked_by: null,
        last_error: null,
        updatedAt: new Date(),
      })
      .where(eq(EmailQueue.id, row.id))
      .catch((err) => logger.error({ err, queueId: row.id }, "dev-mode settle failed"))
    return
  }

  try {
    const { data, error } = await resend.emails.send({
      from: row.from_email,
      to: [row.to_email],
      subject: row.subject,
      html: row.html,
      text: row.text,
    })
    if (error) {
      await handleFailure(row, error.name ?? "unknown_error", error.message ?? "", error.statusCode)
      return
    }
    await markSent(row, data?.id ?? null)
  } catch (err) {
    await handleFailure(row, "exception", err instanceof Error ? err.message : String(err))
  }
}

/**
 * One drain pass: reclaim stuck rows, claim up to RATE_PER_SEC due rows,
 * send them concurrently. Returns a small summary for logging/tests.
 */
export async function runEmailQueueOnce(): Promise<{ claimed: number; reclaimed: number }> {
  const reclaimed = await sweepStuckEmails()
  const rows = await claimDueEmails(RATE_PER_SEC)
  if (rows.length === 0) return { claimed: 0, reclaimed }

  const resend = getResendClient()
  await Promise.allSettled(rows.map((row) => processClaimedEmail(row, resend)))
  return { claimed: rows.length, reclaimed }
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/**
 * Start the in-process drain loop (call once, after the HTTP server is
 * listening). Returns a stop function for graceful shutdown. No-op when
 * EMAIL_WORKER_ENABLED=false or under test.
 */
export function startEmailWorker(): () => void {
  if (process.env.EMAIL_WORKER_ENABLED === "false" || process.env.NODE_ENV === "test") {
    logger.info("email queue worker disabled")
    return () => {}
  }
  if (timer) return stopEmailWorker

  timer = setInterval(async () => {
    if (running) return // a slow tick must not overlap the next
    running = true
    try {
      const summary = await runEmailQueueOnce()
      if (summary.claimed > 0 || summary.reclaimed > 0) {
        logger.info(summary, "email queue drain")
      }
    } catch (err) {
      logger.error({ err }, "email queue drain tick failed")
    } finally {
      running = false
    }
  }, 1_000)

  logger.info({ ratePerSec: RATE_PER_SEC }, "email queue worker started")
  return stopEmailWorker
}

export function stopEmailWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    logger.info("email queue worker stopped")
  }
}
