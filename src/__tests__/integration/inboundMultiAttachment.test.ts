import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Only the downstream processor is mocked — the row creation, the
// per-attachment idempotency, and the real unique index all run against
// Postgres, which is the point of this test.
vi.mock('../../services/invoice/invoiceProcessor.js', () => ({
  processInvoice: vi.fn().mockResolvedValue(undefined),
}));

const { ingestInvoiceAttachments } = await import('../../services/invoice/invoiceIngestion.js');
const { processInvoice } = await import('../../services/invoice/invoiceProcessor.js');
const { db, closeDatabase } = await import('../../db/index.js');
const { Invoice } = await import('../../db/schema/invoice.js');
const { eq } = await import('drizzle-orm');
const { clearDatabase, getOrCreateTestTenant, createTestLocation } = await import('../helpers/testDb.js');

type Attachment = NonNullable<Parameters<typeof ingestInvoiceAttachments>[0]['attachments']>[number];

const pdf = (id: string, filename = `${id}.pdf`): Attachment => ({
  id,
  filename,
  content_type: 'application/pdf',
  content_disposition: 'attachment',
  content_id: null,
});

const baseParams = (tenantId: string, locationId: string | null, attachments: Attachment[]) => ({
  tenantId,
  locationId,
  fromEmail: 'supplier@acme.com',
  fromName: 'Acme',
  subject: 'Invoices',
  messageId: 'msg-1',
  emailId: 'email-abc',
  attachments,
});

describe('integration | inbound email with multiple attachments', () => {
  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(processInvoice).mockClear();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('creates one invoice per attachment, sharing email id but distinct attachment id', async () => {
    const tenantId = await getOrCreateTestTenant();
    const location = await createTestLocation();

    const ids = await ingestInvoiceAttachments(
      baseParams(tenantId, location!.id, [pdf('a1'), pdf('a2'), pdf('a3')]),
    );

    expect(ids).toHaveLength(3);
    const rows = await db.select().from(Invoice).where(eq(Invoice.resend_email_id, 'email-abc'));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.resend_attachment_id))).toEqual(new Set(['a1', 'a2', 'a3']));
    expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
    expect(vi.mocked(processInvoice)).toHaveBeenCalledTimes(3);
  });

  it('is idempotent — a re-delivered webhook does not duplicate rows', async () => {
    const tenantId = await getOrCreateTestTenant();
    const location = await createTestLocation();
    const params = baseParams(tenantId, location!.id, [pdf('a1'), pdf('a2'), pdf('a3')]);

    const first = await ingestInvoiceAttachments(params);
    const second = await ingestInvoiceAttachments(params);

    expect(new Set(second)).toEqual(new Set(first));
    const rows = await db.select().from(Invoice).where(eq(Invoice.resend_email_id, 'email-abc'));
    expect(rows).toHaveLength(3);
  });

  it('resumes a partially-ingested batch, creating only the missing attachments', async () => {
    const tenantId = await getOrCreateTestTenant();
    const location = await createTestLocation();

    // Attachment a1 already ingested on an earlier (interrupted) delivery.
    await db.insert(Invoice).values({
      tenant_id: tenantId,
      location_id: location!.id,
      resend_email_id: 'email-abc',
      resend_attachment_id: 'a1',
      status: 'REVIEW',
    });

    const ids = await ingestInvoiceAttachments(
      baseParams(tenantId, location!.id, [pdf('a1'), pdf('a2'), pdf('a3')]),
    );

    expect(ids).toHaveLength(3); // a1 (existing) + a2 + a3
    const rows = await db.select().from(Invoice).where(eq(Invoice.resend_email_id, 'email-abc'));
    expect(rows).toHaveLength(3);
    // a1 was not reprocessed or reset.
    expect(rows.find((r) => r.resend_attachment_id === 'a1')!.status).toBe('REVIEW');
    expect(vi.mocked(processInvoice)).toHaveBeenCalledTimes(2);
  });

  it('ignores non-file parts and keeps one row per real attachment', async () => {
    const tenantId = await getOrCreateTestTenant();
    const location = await createTestLocation();

    const ids = await ingestInvoiceAttachments(
      baseParams(tenantId, location!.id, [
        pdf('a1'),
        { id: 'a2', filename: 'scan.png', content_type: 'image/png', content_disposition: 'attachment', content_id: null },
        { id: 'a3', filename: 'body.txt', content_type: 'text/plain', content_disposition: 'attachment', content_id: null },
      ]),
    );

    expect(ids).toHaveLength(2);
    const rows = await db.select().from(Invoice).where(eq(Invoice.resend_email_id, 'email-abc'));
    expect(new Set(rows.map((r) => r.resend_attachment_id))).toEqual(new Set(['a1', 'a2']));
  });

  it('treats a single multi-page PDF as exactly one invoice', async () => {
    const tenantId = await getOrCreateTestTenant();
    const location = await createTestLocation();

    const ids = await ingestInvoiceAttachments(
      baseParams(tenantId, location!.id, [pdf('a1', 'invoice-5-pages.pdf')]),
    );

    expect(ids).toHaveLength(1);
    const rows = await db.select().from(Invoice).where(eq(Invoice.resend_email_id, 'email-abc'));
    expect(rows).toHaveLength(1);
    expect(vi.mocked(processInvoice)).toHaveBeenCalledTimes(1);
  });

  it('creates a single FAILED row for an attachment-less email, and does not stack on retry', async () => {
    const tenantId = await getOrCreateTestTenant();
    const location = await createTestLocation();
    const params = baseParams(tenantId, location!.id, []);

    await ingestInvoiceAttachments(params);
    await ingestInvoiceAttachments(params);

    const rows = await db.select().from(Invoice).where(eq(Invoice.resend_email_id, 'email-abc'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('FAILED');
    expect(rows[0]!.resend_attachment_id).toBe('__none__');
  });
});
