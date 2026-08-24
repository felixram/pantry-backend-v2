import { describe, it, expect, beforeEach, afterAll, vi, type Mock } from 'vitest';

// Mock only the three external-service boundaries (Gemini, R2, Resend) —
// everything else (supplier/product matching, discrepancy calc, PO
// matching, the actual DB writes) runs for real against Postgres. This is
// the whole point of an integration test for this pipeline: unit tests
// already cover matchSupplier/matchProduct/calculateItemDiscrepancies in
// isolation, but processInvoice is what actually wires them together
// against real data, and that wiring is exactly where a bug could hide
// even with each piece individually well-tested.
vi.mock('../../services/storage/r2Client.js', () => ({
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('fake-pdf-bytes')),
}));
vi.mock('../../services/ai/geminiService.js', () => ({
  extractInvoiceData: vi.fn(),
}));
vi.mock('../../services/email/emailService.js', () => ({
  sendInvoiceReceivedNotification: vi.fn().mockResolvedValue(undefined),
  sendInvoiceAcknowledgmentEmail: vi.fn().mockResolvedValue(undefined),
}));

const { processInvoice } = await import('../../services/invoice/invoiceProcessor.js');
const { downloadFile } = await import('../../services/storage/r2Client.js');
const { extractInvoiceData } = await import('../../services/ai/geminiService.js');
const { sendInvoiceReceivedNotification } = await import('../../services/email/emailService.js');
const { db, closeDatabase } = await import('../../db/index.js');
const { Invoice } = await import('../../db/schema/invoice.js');
const { InvoiceItem } = await import('../../db/schema/invoiceItem.js');
const { eq } = await import('drizzle-orm');
const { clearDatabase, createTestSupplier, createTestProduct, getOrCreateTestTenant } = await import('../helpers/testDb.js');

async function createTestInvoice(tenantId: string, overrides: Partial<typeof Invoice.$inferInsert> = {}) {
  const [invoice] = await db
    .insert(Invoice)
    .values({
      tenant_id: tenantId,
      original_file_url: 'fake-key/invoice.pdf',
      original_file_type: 'application/pdf',
      status: 'PENDING',
      ...overrides,
    })
    .returning();
  return invoice!;
}

describe('integration | invoice pipeline: extraction -> real supplier/product matching -> persisted result', () => {
  beforeEach(async () => {
    await clearDatabase();
    vi.mocked(extractInvoiceData).mockReset();
    vi.mocked(downloadFile).mockResolvedValue(Buffer.from('fake-pdf-bytes'));
    vi.mocked(sendInvoiceReceivedNotification).mockClear();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('matches a known supplier and product against real DB rows, and persists extracted totals', async () => {
    const tenantId = await getOrCreateTestTenant();
    const supplier = await createTestSupplier({ name: 'Acme Supplies' });
    const product = await createTestProduct({ sku: 'WID-001', name: 'Widget' });
    const invoice = await createTestInvoice(tenantId);

    (extractInvoiceData as Mock).mockResolvedValue({
      supplier: { name: 'Acme Supplies' },
      items: [
        { description: 'Widget', sku: 'WID-001', quantity: 5, unit_price: 10, line_total: 50, taxable: false },
      ],
      subtotal: 50,
      tax: 0,
      total: 50,
      confidence: 0.95,
    });

    await processInvoice(invoice.id, tenantId);

    const [updated] = await db.select().from(Invoice).where(eq(Invoice.id, invoice.id));
    expect(updated?.status).toBe('REVIEW'); // always REVIEW — admin must confirm before stock moves
    expect(updated?.matched_supplier_id).toBe(supplier!.id);
    expect(updated?.extraction_confidence).toBe(0.95);
    expect(updated?.total).toBe(50);

    const items = await db.select().from(InvoiceItem).where(eq(InvoiceItem.invoice_id, invoice.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.matched_product_id).toBe(product!.id);
    expect(items[0]!.extracted_qty).toBe(5);

    expect(sendInvoiceReceivedNotification).toHaveBeenCalledTimes(1);
  });

  it('leaves matched_product_id null for a line item that matches no product, without failing the whole invoice', async () => {
    const tenantId = await getOrCreateTestTenant();
    await createTestSupplier({ name: 'Acme Supplies' });
    const invoice = await createTestInvoice(tenantId);

    (extractInvoiceData as Mock).mockResolvedValue({
      supplier: { name: 'Acme Supplies' },
      items: [
        { description: 'Something Nobody Has Ever Stocked', quantity: 1, unit_price: 1, line_total: 1, taxable: false },
      ],
      subtotal: 1,
      tax: 0,
      total: 1,
      confidence: 0.7,
    });

    await processInvoice(invoice.id, tenantId);

    const [updated] = await db.select().from(Invoice).where(eq(Invoice.id, invoice.id));
    expect(updated?.status).toBe('REVIEW');

    const items = await db.select().from(InvoiceItem).where(eq(InvoiceItem.invoice_id, invoice.id));
    expect(items[0]!.matched_product_id).toBeNull();
  });

  it('marks the invoice FAILED with an error message when the file cannot be downloaded from storage', async () => {
    const tenantId = await getOrCreateTestTenant();
    const invoice = await createTestInvoice(tenantId);
    (downloadFile as Mock).mockResolvedValueOnce(null);

    await processInvoice(invoice.id, tenantId);

    const [updated] = await db.select().from(Invoice).where(eq(Invoice.id, invoice.id));
    expect(updated?.status).toBe('FAILED');
    expect(updated?.processing_error).toBeTruthy();
  });
});
