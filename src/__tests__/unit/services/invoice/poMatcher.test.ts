import { describe, it, expect } from 'vitest';
import { calculateItemDiscrepancies, type InvoiceLineForMatching } from '../../../../services/invoice/poMatcher.js';

function line(overrides: Partial<InvoiceLineForMatching> = {}): InvoiceLineForMatching {
  return { productId: 'prod-1', qty: 10, unitPrice: 5, discountPercent: 0, isOOS: false, ...overrides };
}

function poItem(overrides: Partial<{
  poItemId: string;
  productId: string;
  qty: number;
  unitPrice: number | null;
  received_qty?: number | null;
}> = {}) {
  return { poItemId: 'po-item-1', productId: 'prod-1', qty: 10, unitPrice: 5, received_qty: 0, ...overrides };
}

describe('unit | poMatcher.calculateItemDiscrepancies', () => {
  it('flags no discrepancy when qty and price both match the PO exactly', () => {
    const result = calculateItemDiscrepancies([line()], [poItem()])[0]!;
    expect(result).toEqual({
      matchedPoItemId: 'po-item-1',
      hasQtyDiscrepancy: false,
      hasPriceDiscrepancy: false,
      qtyDiscrepancyAmount: 0,
      priceDiscrepancyAmount: 0,
    });
  });

  it('returns an unmatched result (no discrepancy flags) when the line has no productId', () => {
    const result = calculateItemDiscrepancies([line({ productId: null })], [poItem()])[0]!;
    expect(result.matchedPoItemId).toBeNull();
    expect(result.hasQtyDiscrepancy).toBe(false);
    expect(result.hasPriceDiscrepancy).toBe(false);
  });

  it('returns an unmatched result when the productId has no corresponding PO item', () => {
    const result = calculateItemDiscrepancies([line({ productId: 'unknown-product' })], [poItem()])[0]!;
    expect(result.matchedPoItemId).toBeNull();
  });

  describe('price discrepancy', () => {
    it('flags a price discrepancy beyond the 1-cent tolerance', () => {
      const result = calculateItemDiscrepancies([line({ unitPrice: 6 })], [poItem({ unitPrice: 5 })])[0]!;
      expect(result.hasPriceDiscrepancy).toBe(true);
      expect(result.priceDiscrepancyAmount).toBeCloseTo(1, 2);
    });

    it('does NOT flag a price difference at or under the 1-cent tolerance', () => {
      const result = calculateItemDiscrepancies([line({ unitPrice: 5.01 })], [poItem({ unitPrice: 5 })])[0]!;
      expect(result.hasPriceDiscrepancy).toBe(false);
    });

    it('compares the post-discount effective price against the PO price, not the raw unit price', () => {
      // $10/unit with 50% discount = $5 effective, matching the PO's $5 — no discrepancy
      // despite the raw unitPrice (10) looking very different from the PO price (5).
      const result = calculateItemDiscrepancies(
        [line({ unitPrice: 10, discountPercent: 50 })],
        [poItem({ unitPrice: 5 })]
      )[0]!;
      expect(result.hasPriceDiscrepancy).toBe(false);
    });

    it('never flags a price discrepancy when the matched PO item has a null unit price', () => {
      const result = calculateItemDiscrepancies([line({ unitPrice: 999 })], [poItem({ unitPrice: null })])[0]!;
      expect(result.hasPriceDiscrepancy).toBe(false);
      expect(result.priceDiscrepancyAmount).toBe(0);
    });
  });

  describe('qty discrepancy', () => {
    it('flags a qty discrepancy when invoiced qty differs from outstanding PO qty', () => {
      const result = calculateItemDiscrepancies([line({ qty: 8 })], [poItem({ qty: 10, received_qty: 0 })])[0]!;
      expect(result.hasQtyDiscrepancy).toBe(true);
      expect(result.qtyDiscrepancyAmount).toBe(-2);
    });

    it('compares against OUTSTANDING qty (qty - received_qty), not the PO item\'s original full qty', () => {
      // PO for 10, 6 already received on a prior invoice — this invoice
      // correctly covers the remaining 4, so it must NOT be flagged even
      // though 4 !== the PO's original qty of 10.
      const result = calculateItemDiscrepancies([line({ qty: 4 })], [poItem({ qty: 10, received_qty: 6 })])[0]!;
      expect(result.hasQtyDiscrepancy).toBe(false);
      expect(result.qtyDiscrepancyAmount).toBe(0);
    });

    it('never flags a qty discrepancy for an out-of-stock line', () => {
      const result = calculateItemDiscrepancies([line({ qty: 999, isOOS: true })], [poItem({ qty: 10 })])[0]!;
      expect(result.hasQtyDiscrepancy).toBe(false);
    });

    it('aggregates qty across multiple invoice lines mapped to the same PO item, and assigns the discrepancy only once', () => {
      // Two invoice lines for the same product (e.g. split across two
      // pallets on the paper invoice) summing to the outstanding qty —
      // correct in aggregate, so neither line should be flagged.
      const lines = [line({ qty: 6 }), line({ qty: 4 })];
      const results = calculateItemDiscrepancies(lines, [poItem({ qty: 10, received_qty: 0 })]);

      expect(results[0]!.hasQtyDiscrepancy).toBe(false);
      expect(results[1]!.hasQtyDiscrepancy).toBe(false);
    });

    it('assigns an aggregate qty mismatch to only the first line for that PO item, not every line', () => {
      const lines = [line({ qty: 6 }), line({ qty: 4 })]; // sums to 10, but PO only expects 5 outstanding
      const results = calculateItemDiscrepancies(lines, [poItem({ qty: 5, received_qty: 0 })]);

      expect(results[0]!.hasQtyDiscrepancy).toBe(true);
      expect(results[0]!.qtyDiscrepancyAmount).toBe(5); // 10 total invoiced - 5 outstanding
      // Second line shares the same matched PO item — already assigned,
      // so it reports no discrepancy of its own rather than double-counting.
      expect(results[1]!.hasQtyDiscrepancy).toBe(false);
      expect(results[1]!.qtyDiscrepancyAmount).toBe(0);
    });

    it('excludes OOS lines from the aggregate receivable qty used for discrepancy comparison', () => {
      // One real line (qty 10, matches outstanding exactly) plus a bogus
      // OOS line for the same product that must not pollute the aggregate.
      const lines = [line({ qty: 10 }), line({ qty: 500, isOOS: true })];
      const results = calculateItemDiscrepancies(lines, [poItem({ qty: 10, received_qty: 0 })]);

      expect(results[0]!.hasQtyDiscrepancy).toBe(false);
    });
  });
});
