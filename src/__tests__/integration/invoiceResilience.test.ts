import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// retry() calls processInvoice() fire-and-forget — stub it so the test
// asserts only the retry_count bump, not a real R2/Gemini round-trip.
vi.mock('../../services/invoice/invoiceProcessor.js', () => ({
  processInvoice: vi.fn().mockResolvedValue(undefined),
}));

const { db, closeDatabase } = await import('../../db/index.js');
const { t } = await import('../../server/trpc.js');
const { appRouter } = await import('../../server/routers/index.js');
const { Invoice } = await import('../../db/schema/invoice.js');
const { InvoiceItem } = await import('../../db/schema/invoiceItem.js');
const { UsageEvent } = await import('../../db/schema/usageEvent.js');
const { Tenant } = await import('../../db/schema/tenant.js');
const { eq } = await import('drizzle-orm');
const { ROLES } = await import('../../types/user.js');
const {
  clearDatabase,
  getOrCreateTestTenant,
  createTestUser,
  createTestSupplier,
  createTestProduct,
} = await import('../helpers/testDb.js');

const createCaller = t.createCallerFactory(appRouter);

function adminCaller(user: { id: string; role: string }, tenantId: string) {
  return createCaller({
    req: {} as never,
    res: {} as never,
    db,
    user: { id: user.id, role: user.role },
    userLocationId: null,
    tenantId,
    isDemoTenant: false,
    clerkUserId: null,
    clerkOrgId: null,
    isOwner: false,
  });
}

function ownerCaller() {
  return createCaller({
    req: {} as never,
    res: {} as never,
    db,
    user: null,
    userLocationId: null,
    tenantId: null,
    isDemoTenant: false,
    clerkUserId: null,
    clerkOrgId: null,
    isOwner: true,
  });
}

async function createFailedInvoice(tenantId: string, overrides: Partial<typeof Invoice.$inferInsert> = {}) {
  const [invoice] = await db
    .insert(Invoice)
    .values({
      tenant_id: tenantId,
      original_file_url: 'fake-key/invoice.pdf',
      original_file_type: 'application/pdf',
      status: 'FAILED',
      processing_error: 'Gemini extraction failed after 3 attempts',
      ...overrides,
    })
    .returning();
  return invoice!;
}

describe('integration | invoice resilience: retry counter, manual entry, owner reliability', () => {
  beforeEach(async () => {
    await clearDatabase();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('invoice.retry increments retry_count', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@example.com' });
    const invoice = await createFailedInvoice(tenantId);

    const caller = adminCaller(admin!, tenantId);
    await caller.invoice.retry({ invoiceId: invoice.id });
    await caller.invoice.retry({ invoiceId: invoice.id }).catch(() => {
      // second retry runs against a PENDING invoice after the first reset —
      // only the counter matters here, re-fetch below asserts it
    });

    const [row] = await db.select().from(Invoice).where(eq(Invoice.id, invoice.id));
    expect(row!.retry_count).toBeGreaterThanOrEqual(1);
  });

  it('invoice.manualEntry turns a FAILED invoice into a REVIEW invoice with items', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@example.com' });
    const supplier = await createTestSupplier({ name: 'Hand Keyed Co' });
    const product = await createTestProduct({ name: 'Keyed Widget' });
    const invoice = await createFailedInvoice(tenantId);

    const caller = adminCaller(admin!, tenantId);
    const result = await caller.invoice.manualEntry({
      invoiceId: invoice.id,
      supplierId: supplier!.id,
      invoiceNumber: 'MAN-001',
      subtotal: 100,
      taxAmount: 0,
      total: 100,
      items: [
        { description: 'Keyed Widget', qty: 4, unitPrice: 25, taxable: false, productId: product!.id },
        { description: 'Unmatched line', qty: 2, unitPrice: 5, taxable: true },
      ],
    });

    expect(result.message).toMatch(/review/i);

    const [row] = await db.select().from(Invoice).where(eq(Invoice.id, invoice.id));
    expect(row!.status).toBe('REVIEW');
    expect(row!.manual_entry).toBe(true);
    expect(row!.matched_supplier_id).toBe(supplier!.id);
    expect(row!.invoice_number).toBe('MAN-001');

    const items = await db.select().from(InvoiceItem).where(eq(InvoiceItem.invoice_id, invoice.id));
    expect(items).toHaveLength(2);
    const matched = items.find((i) => i.extracted_name === 'Keyed Widget')!;
    expect(matched.confirmed_product_id).toBe(product!.id);
    expect(matched.match_method).toBe('manual');
    const unmatched = items.find((i) => i.extracted_name === 'Unmatched line')!;
    expect(unmatched.confirmed_product_id).toBeNull();
  });

  it('invoice.manualEntry rejects a non-FAILED invoice', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@example.com' });
    const invoice = await createFailedInvoice(tenantId, { status: 'REVIEW', processing_error: null });

    const caller = adminCaller(admin!, tenantId);
    await expect(
      caller.invoice.manualEntry({
        invoiceId: invoice.id,
        items: [{ description: 'x', qty: 1, unitPrice: 1, taxable: true }],
      }),
    ).rejects.toThrow(/failed invoices/i);
  });

  it('invoice.manualEntry rejects a product / supplier from another tenant', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@example.com' });
    const invoice = await createFailedInvoice(tenantId);

    const [otherTenant] = await db
      .insert(Tenant)
      .values({ name: 'Other Co', slug: 'other-co', plan: 'free' })
      .returning();
    const foreignProduct = await createTestProduct({ name: 'Foreign', tenant_id: otherTenant!.id });
    const foreignSupplier = await createTestSupplier({ name: 'Foreign Supplier', tenant_id: otherTenant!.id });

    const caller = adminCaller(admin!, tenantId);

    await expect(
      caller.invoice.manualEntry({
        invoiceId: invoice.id,
        items: [{ description: 'x', qty: 1, unitPrice: 1, taxable: true, productId: foreignProduct!.id }],
      }),
    ).rejects.toThrow(/not found/i);

    await expect(
      caller.invoice.manualEntry({
        invoiceId: invoice.id,
        supplierId: foreignSupplier!.id,
        items: [{ description: 'x', qty: 1, unitPrice: 1, taxable: true }],
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('owner.aiReliability aggregates OK/FAILED outcome rows and currently-failed invoices', async () => {
    const tenantId = await getOrCreateTestTenant();
    await createFailedInvoice(tenantId); // one invoice sitting in FAILED

    await db.insert(UsageEvent).values([
      { tenant_id: tenantId, eventType: 'AI_INVOICE_EXTRACTION_OK', quantity: 1, metadata: { model: 'm' } },
      { tenant_id: tenantId, eventType: 'AI_INVOICE_EXTRACTION_OK', quantity: 1, metadata: { model: 'm' } },
      { tenant_id: tenantId, eventType: 'AI_INVOICE_EXTRACTION_OK', quantity: 1, metadata: { model: 'm' } },
      { tenant_id: tenantId, eventType: 'AI_INVOICE_EXTRACTION_FAILED', quantity: 1, metadata: { model: 'm', errorType: 'RATE_LIMIT' } },
      // pre-existing per-attempt token rows must be ignored by this query
      { tenant_id: tenantId, eventType: 'AI_INVOICE_EXTRACTION', quantity: 4200, metadata: { model: 'm' } },
    ]);

    const result = await ownerCaller().owner.aiReliability({ days: 30 });

    expect(result.overall.ok).toBe(3);
    expect(result.overall.failed).toBe(1);
    expect(result.overall.failureRate).toBeCloseTo(0.25);
    expect(result.overall.currentlyFailed).toBe(1);

    const tenantRow = result.byTenant.find((r) => r.tenantId === tenantId)!;
    expect(tenantRow.errorBreakdown.RATE_LIMIT).toBe(1);
    expect(tenantRow.errorBreakdown.OTHER).toBe(0);
  });

  it('owner.aiReliability is gated on ctx.isOwner', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@example.com' });
    await expect(
      adminCaller(admin!, tenantId).owner.aiReliability({ days: 30 }),
    ).rejects.toThrow();
  });
});
