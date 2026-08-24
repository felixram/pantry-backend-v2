import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockValues = vi.fn();
const mockDb = { insert: vi.fn(() => ({ values: mockValues })) };
vi.mock('../../../../db/index.js', () => ({ db: mockDb }));
vi.mock('../../../../db/schema/usageEvent.js', () => ({ UsageEvent: 'UsageEvent-table-marker' }));

const { recordUsageEvent } = await import('../../../../services/usage/recordUsageEvent.js');

describe('unit | recordUsageEvent (usage_event ledger writer)', () => {
  beforeEach(() => {
    mockDb.insert.mockClear();
    mockValues.mockReset();
    mockValues.mockResolvedValue(undefined);
  });

  it('inserts with the tenant/eventType/quantity mapped correctly', async () => {
    await recordUsageEvent({ tenantId: 'tenant-1', eventType: 'EMAIL_SENT', quantity: 1 });

    expect(mockDb.insert).toHaveBeenCalledWith('UsageEvent-table-marker');
    expect(mockValues).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      eventType: 'EMAIL_SENT',
      quantity: 1,
      costEstimate: null,
      metadata: null,
    });
  });

  it('rounds a fractional quantity (e.g. a raw token/byte count) to the nearest integer', async () => {
    await recordUsageEvent({ tenantId: 't1', eventType: 'AI_INVOICE_EXTRACTION', quantity: 4200.7 });
    expect(mockValues.mock.calls[0]![0].quantity).toBe(4201);
  });

  it('passes through an explicit costEstimate and metadata when provided', async () => {
    await recordUsageEvent({
      tenantId: 't1',
      eventType: 'FILE_STORAGE',
      quantity: 1024,
      costEstimate: 0.02,
      metadata: { filename: 'invoice.pdf' },
    });
    expect(mockValues.mock.calls[0]![0]).toMatchObject({
      costEstimate: 0.02,
      metadata: { filename: 'invoice.pdf' },
    });
  });

  it('never throws when the DB insert fails — a metering failure must not break the caller', async () => {
    mockValues.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      recordUsageEvent({ tenantId: 't1', eventType: 'EMAIL_SENT', quantity: 1 })
    ).resolves.toBeUndefined();
  });
});
