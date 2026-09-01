import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { Resend } from 'resend';
import { db, closeDatabase } from '../../db/index.js';
import { EmailQueue } from '../../db/schema/emailQueue.js';
import { UsageEvent } from '../../db/schema/usageEvent.js';
import { eq, and } from 'drizzle-orm';
import { enqueueEmail } from '../../services/email/enqueueEmail.js';
import {
  claimDueEmails,
  processClaimedEmail,
  sweepStuckEmails,
  runEmailQueueOnce,
  type ClaimedEmailRow,
} from '../../services/email/emailQueueWorker.js';
import { EMAIL_TYPE } from '../../types/email.js';
import { USAGE_EVENT_TYPE } from '../../types/usage.js';
import { clearDatabase, getOrCreateTestTenant } from '../helpers/testDb.js';

const baseEmail = (over: Partial<Parameters<typeof enqueueEmail>[0]> = {}) => ({
  to: 'a@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
  emailType: EMAIL_TYPE.invoice_received,
  ...over,
});

const fakeResend = (impl: () => unknown) =>
  ({ emails: { send: async () => impl() } } as unknown as Resend);

describe('integration | email queue', () => {
  beforeEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('enqueues a pending row and dedupes on idempotency key', async () => {
    const tenantId = await getOrCreateTestTenant();

    const first = await enqueueEmail(baseEmail({ tenantId, idempotencyKey: 'k1' }));
    expect(first.queued).toBe(true);

    const dup = await enqueueEmail(baseEmail({ tenantId, idempotencyKey: 'k1' }));
    expect(dup.queued).toBe(false);
    expect(dup.id).toBeNull();

    const rows = await db.select().from(EmailQueue).where(eq(EmailQueue.tenant_id, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.priority).toBe(50); // invoice_received default
    expect(rows[0]!.attempts).toBe(0);
  });

  it('claims due rows atomically — two concurrent claims never overlap', async () => {
    const tenantId = await getOrCreateTestTenant();
    await Promise.all([
      enqueueEmail(baseEmail({ tenantId, to: 'a@x.com' })),
      enqueueEmail(baseEmail({ tenantId, to: 'b@x.com' })),
      enqueueEmail(baseEmail({ tenantId, to: 'c@x.com' })),
    ]);

    const [a, b] = await Promise.all([claimDueEmails(10), claimDueEmails(10)]);
    const ids = [...a, ...b].map((r) => r.id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // disjoint
    for (const row of [...a, ...b]) {
      expect(row.attempts).toBe(1); // bumped by the claim
    }
  });

  it('marks a row sent and records exactly one EMAIL_SENT usage row', async () => {
    const tenantId = await getOrCreateTestTenant();
    await enqueueEmail(baseEmail({ tenantId }));
    const [row] = await claimDueEmails(10);

    await processClaimedEmail(row!, fakeResend(() => ({ data: { id: 'resend-123' }, error: null })));

    const [after] = await db.select().from(EmailQueue).where(eq(EmailQueue.id, row!.id));
    expect(after!.status).toBe('sent');
    expect(after!.provider_message_id).toBe('resend-123');
    expect(after!.locked_at).toBeNull();

    const usage = await db
      .select()
      .from(UsageEvent)
      .where(and(eq(UsageEvent.tenant_id, tenantId), eq(UsageEvent.eventType, USAGE_EVENT_TYPE.email_sent)));
    expect(usage).toHaveLength(1);
    expect((usage[0]!.metadata as Record<string, unknown>).messageId).toBe('resend-123');
  });

  it('requeues with backoff on a rate-limit error, without an EMAIL_SENT row', async () => {
    const tenantId = await getOrCreateTestTenant();
    await enqueueEmail(baseEmail({ tenantId }));
    const [row] = await claimDueEmails(10);

    await processClaimedEmail(
      row!,
      fakeResend(() => ({ data: null, error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 } })),
    );

    const [after] = await db.select().from(EmailQueue).where(eq(EmailQueue.id, row!.id));
    expect(after!.status).toBe('pending');
    expect(after!.attempts).toBe(1);
    expect(after!.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 1_000);
    expect(after!.last_error).toContain('rate_limit_exceeded');

    const usage = await db.select().from(UsageEvent).where(eq(UsageEvent.tenant_id, tenantId));
    expect(usage).toHaveLength(0);
  });

  it('fails immediately on a permanent (422) error and records EMAIL_FAILED', async () => {
    const tenantId = await getOrCreateTestTenant();
    await enqueueEmail(baseEmail({ tenantId }));
    const [row] = await claimDueEmails(10);

    await processClaimedEmail(
      row!,
      fakeResend(() => ({ data: null, error: { name: 'validation_error', message: 'bad address', statusCode: 422 } })),
    );

    const [after] = await db.select().from(EmailQueue).where(eq(EmailQueue.id, row!.id));
    expect(after!.status).toBe('failed');
    expect(after!.attempts).toBe(1); // no further retries

    const failed = await db
      .select()
      .from(UsageEvent)
      .where(and(eq(UsageEvent.tenant_id, tenantId), eq(UsageEvent.eventType, USAGE_EVENT_TYPE.email_failed)));
    expect(failed).toHaveLength(1);
  });

  it('moves a retryable row to failed once attempts hit max_attempts', async () => {
    const tenantId = await getOrCreateTestTenant();
    const row: ClaimedEmailRow = {
      id: (await enqueueEmail(baseEmail({ tenantId }))).id!,
      tenant_id: tenantId,
      email_type: EMAIL_TYPE.invoice_received,
      to_email: 'a@example.com',
      from_email: 'noreply@govantory.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      attempts: 5,
      max_attempts: 5,
    };

    await processClaimedEmail(
      row,
      fakeResend(() => ({ data: null, error: { name: 'internal_server_error', message: 'oops', statusCode: 500 } })),
    );

    const [after] = await db.select().from(EmailQueue).where(eq(EmailQueue.id, row.id));
    expect(after!.status).toBe('failed');
  });

  it('sweepStuckEmails re-queues a row abandoned in processing', async () => {
    const tenantId = await getOrCreateTestTenant();
    const { id } = await enqueueEmail(baseEmail({ tenantId }));
    await db
      .update(EmailQueue)
      .set({ status: 'processing', locked_at: new Date(Date.now() - 10 * 60 * 1000), locked_by: 'dead-box' })
      .where(eq(EmailQueue.id, id!));

    const reclaimed = await sweepStuckEmails();
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const [after] = await db.select().from(EmailQueue).where(eq(EmailQueue.id, id!));
    expect(after!.status).toBe('pending');
    expect(after!.locked_at).toBeNull();
  });

  it('runEmailQueueOnce claims no more than the per-second rate', async () => {
    const tenantId = await getOrCreateTestTenant();
    for (let i = 0; i < 5; i++) {
      await enqueueEmail(baseEmail({ tenantId, to: `u${i}@x.com` }));
    }

    // No RESEND_API_KEY in CI → dev-mode marks claimed rows 'sent'.
    const summary = await runEmailQueueOnce();
    expect(summary.claimed).toBe(2); // EMAIL_RATE_LIMIT_PER_SEC default

    const sent = await db.select().from(EmailQueue).where(eq(EmailQueue.status, 'sent'));
    const pending = await db.select().from(EmailQueue).where(eq(EmailQueue.status, 'pending'));
    expect(sent).toHaveLength(2);
    expect(pending).toHaveLength(3);
  });
});
