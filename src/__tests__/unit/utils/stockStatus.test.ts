import { describe, it, expect } from 'vitest';
import { computeStockStatus } from '../../../utils/stockStatus.js';

describe('unit | stockStatus.computeStockStatus (single source of truth, replaced 6 drifted copies)', () => {
  it('qty of exactly 0 is always OUT_OF_STOCK, regardless of minimum level', () => {
    expect(computeStockStatus({ qty: 0, minimumStockLevel: 0 })).toBe('OUT_OF_STOCK');
    expect(computeStockStatus({ qty: 0, minimumStockLevel: 100 })).toBe('OUT_OF_STOCK');
    expect(computeStockStatus({ qty: 0, minimumStockLevel: null })).toBe('OUT_OF_STOCK');
  });

  it('qty at or below the minimum (but above 0) is LOW', () => {
    expect(computeStockStatus({ qty: 5, minimumStockLevel: 5 })).toBe('LOW');
    expect(computeStockStatus({ qty: 3, minimumStockLevel: 5 })).toBe('LOW');
  });

  it('qty above the minimum is OK', () => {
    expect(computeStockStatus({ qty: 10, minimumStockLevel: 5 })).toBe('OK');
  });

  it('a null/undefined minimumStockLevel means no LOW threshold — anything above 0 is OK', () => {
    expect(computeStockStatus({ qty: 1, minimumStockLevel: null })).toBe('OK');
    expect(computeStockStatus({ qty: 1, minimumStockLevel: undefined })).toBe('OK');
  });

  describe('expectedUsage adjustment (used by getSuggestedPOs)', () => {
    it('when omitted, behaves byte-identical to the plain qty-only formula', () => {
      expect(computeStockStatus({ qty: 10, minimumStockLevel: 5 })).toBe(
        computeStockStatus({ qty: 10, minimumStockLevel: 5, expectedUsage: null })
      );
    });

    it('subtracts expectedUsage from qty before comparing to the minimum', () => {
      // qty 10, minimum 5, but 6 units of expected usage brings the
      // effective qty to 4 — below minimum, so LOW even though raw qty
      // alone would read OK.
      expect(computeStockStatus({ qty: 10, minimumStockLevel: 5, expectedUsage: 6 })).toBe('LOW');
    });

    it('does NOT reclassify qty=0 as anything other than OUT_OF_STOCK, even with expectedUsage set', () => {
      expect(computeStockStatus({ qty: 0, minimumStockLevel: 5, expectedUsage: -10 })).toBe('OUT_OF_STOCK');
    });

    it('a negative effective qty (expectedUsage exceeds current qty) is still just LOW, not a distinct status', () => {
      expect(computeStockStatus({ qty: 5, minimumStockLevel: 2, expectedUsage: 20 })).toBe('LOW');
    });
  });
});
