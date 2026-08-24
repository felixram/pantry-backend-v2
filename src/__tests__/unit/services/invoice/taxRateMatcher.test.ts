import { describe, it, expect, vi } from 'vitest';
import { matchTaxRate, matchAllTaxRates, type TaxRateMatchInput } from '../../../../services/invoice/taxRateMatcher.js';

const RATES = [
  { id: 'rate-8', rate: 8 },
  { id: 'rate-8.875', rate: 8.875 },
];

function input(overrides: Partial<TaxRateMatchInput> = {}): TaxRateMatchInput {
  return { taxable: true, taxAmount: 8, lineTotal: 100, ...overrides };
}

describe('unit | taxRateMatcher.matchTaxRate', () => {
  it('returns no match for a non-taxable line', () => {
    expect(matchTaxRate(input({ taxable: false }), RATES)).toEqual({ taxRateId: null, computedRate: null });
  });

  it('returns no match when taxAmount is null/undefined', () => {
    expect(matchTaxRate(input({ taxAmount: null }), RATES).taxRateId).toBeNull();
    expect(matchTaxRate(input({ taxAmount: undefined }), RATES).taxRateId).toBeNull();
  });

  it('returns no match when taxAmount is zero or negative', () => {
    expect(matchTaxRate(input({ taxAmount: 0 }), RATES).taxRateId).toBeNull();
    expect(matchTaxRate(input({ taxAmount: -5 }), RATES).taxRateId).toBeNull();
  });

  it('returns no match when lineTotal is zero or negative', () => {
    expect(matchTaxRate(input({ lineTotal: 0 }), RATES).taxRateId).toBeNull();
  });

  it('matches an exact rate', () => {
    // $8 tax on $100 = exactly 8%
    const result = matchTaxRate(input({ taxAmount: 8, lineTotal: 100 }), RATES);
    expect(result.taxRateId).toBe('rate-8');
    expect(result.computedRate).toBeCloseTo(8, 5);
  });

  it('matches within tolerance and picks the genuinely closest configured rate', () => {
    // Implied rate 8.05% is close to both 8 and 8.875, but closer to 8.
    const result = matchTaxRate(input({ taxAmount: 8.05, lineTotal: 100 }), RATES);
    expect(result.taxRateId).toBe('rate-8');
  });

  it('matches the other candidate when computed rate sits closer to it', () => {
    const result = matchTaxRate(input({ taxAmount: 8.8, lineTotal: 100 }), RATES);
    expect(result.taxRateId).toBe('rate-8.875');
  });

  it('does not match when the computed rate is outside tolerance of every configured rate, but still reports computedRate', () => {
    const result = matchTaxRate(input({ taxAmount: 20, lineTotal: 100 }), RATES); // 20%, nowhere near 8/8.875
    expect(result.taxRateId).toBeNull();
    expect(result.computedRate).toBeCloseTo(20, 5);
  });

  it('matches comfortably within the tolerance boundary', () => {
    const result = matchTaxRate(input({ taxAmount: 8.14, lineTotal: 100 }), RATES); // 8.14%, diff 0.14 < 0.15
    expect(result.taxRateId).toBe('rate-8');
  });

  it('does not match comfortably past the tolerance boundary', () => {
    const result = matchTaxRate(input({ taxAmount: 8.2, lineTotal: 100 }), RATES); // 8.2%, diff 0.2 > 0.15
    expect(result.taxRateId).toBeNull();
  });

  it('returns no match (but no crash) against an empty rate list', () => {
    const result = matchTaxRate(input(), []);
    expect(result.taxRateId).toBeNull();
    expect(result.computedRate).not.toBeNull();
  });
});

describe('unit | taxRateMatcher.matchAllTaxRates', () => {
  it('skips the DB query entirely when no item needs matching (all non-taxable / zero tax)', async () => {
    const dbSpy = vi.fn();
    const fakeDb = { query: { TaxRate: { findMany: dbSpy } } } as unknown as Parameters<typeof matchAllTaxRates>[0];

    const items = [input({ taxable: false }), input({ taxAmount: 0 })];
    const results = await matchAllTaxRates(fakeDb, 'tenant-1', items);

    expect(dbSpy).not.toHaveBeenCalled();
    expect(results).toEqual([
      { taxRateId: null, computedRate: null },
      { taxRateId: null, computedRate: null },
    ]);
  });

  it('queries the DB and matches every item when at least one line needs matching', async () => {
    const dbSpy = vi.fn().mockResolvedValue(RATES);
    const fakeDb = { query: { TaxRate: { findMany: dbSpy } } } as unknown as Parameters<typeof matchAllTaxRates>[0];

    const items = [input({ taxable: false }), input({ taxAmount: 8, lineTotal: 100 })];
    const results = await matchAllTaxRates(fakeDb, 'tenant-1', items);

    expect(dbSpy).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({ taxRateId: null, computedRate: null });
    expect(results[1]!.taxRateId).toBe('rate-8');
  });
});
