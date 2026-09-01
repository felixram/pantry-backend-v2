import { db } from "../../db/index.ts"
import { EmailQueue } from "../../db/schema/emailQueue.ts"
import { EMAIL_PRIORITY, type EmailType } from "../../types/email.ts"
import { getFromEmail } from "./resendClient.ts"
import { logger } from "../../utils/logger.ts"

const DEFAULT_MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS ?? 5)

export interface EnqueueEmailInput {
  to: string
  subject: string
  html: string
  text: string
  emailType: EmailType
  /** Nullable — invitations can be sent before a tenant context exists. */
  tenantId?: string | null | undefined
  /** Overrides the per-type default from EMAIL_PRIORITY (lower drains first). */
  priority?: number
  /**
   * Natural dedupe key. A second enqueue with the same key is a no-op that
   * returns `{ queued: false }`. Omit for mail that should always send.
   */
  idempotencyKey?: string
  fromEmail?: string
  maxAttempts?: number
}

export interface EnqueueEmailResult {
  queued: boolean
  id: string | null
}

/**
 * Puts one email on the queue. The worker (emailQueueWorker.ts) picks it up
 * within ~1s and sends it no faster than the provider's request limit.
 * Never sends inline — callers get back only whether the row was accepted.
 */
export async function enqueueEmail(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
  try {
    const [row] = await db
      .insert(EmailQueue)
      .values({
        tenant_id: input.tenantId ?? null,
        status: "pending",
        priority: input.priority ?? EMAIL_PRIORITY[input.emailType] ?? 50,
        email_type: input.emailType,
        to_email: input.to,
        from_email: input.fromEmail ?? getFromEmail(),
        subject: input.subject,
        html: input.html,
        text: input.text,
        idempotency_key: input.idempotencyKey ?? null,
        max_attempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      })
      // NULL idempotency_key never conflicts, so keyless mail always inserts.
      .onConflictDoNothing({ target: EmailQueue.idempotency_key })
      .returning({ id: EmailQueue.id })

    if (!row) {
      return { queued: false, id: null }
    }
    return { queued: true, id: row.id }
  } catch (err) {
    // Enqueue failing must not take down the flow that triggered the email
    // (invoice processing, user invite). Surface it and move on.
    logger.error({ err, to: input.to, emailType: input.emailType }, "Failed to enqueue email")
    return { queued: false, id: null }
  }
}
