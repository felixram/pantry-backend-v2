import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Force GEMINI_API_KEY so getGenAI() builds a client instead of bailing.
process.env.GEMINI_API_KEY = 'test-key';

const generateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
  },
}));

const { extractInvoiceData, classifyExtractionError } = await import('../../services/ai/geminiService.js');
const { db, closeDatabase } = await import('../../db/index.js');
const { UsageEvent } = await import('../../db/schema/usageEvent.js');
const { eq, and } = await import('drizzle-orm');
const { clearDatabase, getOrCreateTestTenant } = await import('../helpers/testDb.js');

describe('integration | gemini extraction failure telemetry', () => {
  beforeEach(async () => {
    await clearDatabase();
    generateContent.mockReset();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('classifies error messages into buckets', () => {
    expect(classifyExtractionError(new Error('got a 429 RESOURCE_EXHAUSTED'))).toBe('RATE_LIMIT');
    expect(classifyExtractionError(new Error('503 upstream unavailable'))).toBe('UNAVAILABLE');
    expect(classifyExtractionError(new Error('Gemini returned an empty response'))).toBe('EMPTY_RESPONSE');
    expect(classifyExtractionError(new SyntaxError('Unexpected token in JSON'))).toBe('PARSE_ERROR');
    expect(classifyExtractionError(new Error('something else entirely'))).toBe('OTHER');
  });

  it('writes one AI_INVOICE_EXTRACTION_FAILED usage row when extraction fails terminally', async () => {
    const tenantId = await getOrCreateTestTenant();
    // Non-retryable error → throws on the first attempt, no backoff sleeps.
    generateContent.mockRejectedValue(new Error('permission denied for this document'));

    await expect(
      extractInvoiceData(Buffer.from('pdf-bytes'), 'application/pdf', null, tenantId),
    ).rejects.toThrow(/permission denied/);

    const rows = await db
      .select()
      .from(UsageEvent)
      .where(
        and(
          eq(UsageEvent.tenant_id, tenantId),
          eq(UsageEvent.eventType, 'AI_INVOICE_EXTRACTION_FAILED'),
        ),
      );

    expect(rows).toHaveLength(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.errorType).toBe('OTHER');
    expect(meta.attempts).toBe(1);
    expect(typeof meta.errorMessage).toBe('string');
  });

  it('writes one AI_INVOICE_EXTRACTION_OK usage row on success', async () => {
    const tenantId = await getOrCreateTestTenant();
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        supplier: { name: 'Acme' },
        items: [{ description: 'Widget', quantity: 1, unit_price: 10, line_total: 10, taxable: false }],
        subtotal: 10,
        tax: 0,
        total: 10,
        confidence: 0.9,
      }),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    const result = await extractInvoiceData(Buffer.from('pdf-bytes'), 'application/pdf', null, tenantId);
    expect(result.supplier.name).toBe('Acme');

    const okRows = await db
      .select()
      .from(UsageEvent)
      .where(
        and(eq(UsageEvent.tenant_id, tenantId), eq(UsageEvent.eventType, 'AI_INVOICE_EXTRACTION_OK')),
      );
    expect(okRows).toHaveLength(1);

    // The existing per-attempt token row is still written too.
    const tokenRows = await db
      .select()
      .from(UsageEvent)
      .where(
        and(eq(UsageEvent.tenant_id, tenantId), eq(UsageEvent.eventType, 'AI_INVOICE_EXTRACTION')),
      );
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0]!.quantity).toBe(150);
  });
});
