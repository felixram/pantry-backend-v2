import { describe, it, expect } from 'vitest';
import { matchProduct } from '../../../../services/invoice/productMatcher.js';

// matchProduct accepts pre-fetched caches — passing them directly exercises
// the real matching cascade with zero DB mocking needed (the DB is only
// ever touched when a cache is omitted).
function product(overrides: Partial<{ id: string; name: string; sku: string | null; supplier_id: string | null }> = {}) {
  return { id: 'prod-1', name: 'Widget', sku: 'WID-001', supplier_id: null, ...overrides } as never;
}

function item(overrides: Partial<{ description: string; sku?: string; quantity: number; unit_price: number; line_total: number }> = {}) {
  return { description: 'Widget', quantity: 1, unit_price: 10, line_total: 10, ...overrides };
}

describe('unit | productMatcher.matchProduct (priority cascade)', () => {
  it('SKU exact match wins over everything, case-insensitively', async () => {
    const products = [product({ id: 'p1', sku: 'ABC-123' })];
    const result = await matchProduct(
      {} as never,
      'tenant-1',
      item({ sku: 'abc-123', description: 'totally different description' }),
      null,
      products,
      []
    );
    expect(result).toEqual({ productId: 'p1', confidence: 0.98, method: 'sku_exact' });
  });

  describe('alias match — confidence scales with use_count', () => {
    it('use_count >= 5 → 0.97', async () => {
      const products = [product({ id: 'p1' })];
      const aliases = [{ id: 'a1', alias_name: 'the widget thing', product_id: 'p1', use_count: 5 }];
      const result = await matchProduct({} as never, 't1', item({ description: 'the widget thing' }), null, products, aliases);
      expect(result).toEqual({ productId: 'p1', confidence: 0.97, method: 'alias_exact' });
    });

    it('use_count >= 2 and < 5 → 0.95', async () => {
      const products = [product({ id: 'p1' })];
      const aliases = [{ id: 'a1', alias_name: 'the widget thing', product_id: 'p1', use_count: 2 }];
      const result = await matchProduct({} as never, 't1', item({ description: 'the widget thing' }), null, products, aliases);
      expect(result.confidence).toBe(0.95);
    });

    it('use_count < 2 → 0.93', async () => {
      const products = [product({ id: 'p1' })];
      const aliases = [{ id: 'a1', alias_name: 'the widget thing', product_id: 'p1', use_count: 1 }];
      const result = await matchProduct({} as never, 't1', item({ description: 'the widget thing' }), null, products, aliases);
      expect(result.confidence).toBe(0.93);
    });

    it('alias match wins over name-exact, even though both would match this description', async () => {
      const products = [product({ id: 'p-name-match', name: 'the widget thing' })];
      const aliases = [{ id: 'a1', alias_name: 'the widget thing', product_id: 'p-alias-match', use_count: 5 }];
      const result = await matchProduct({} as never, 't1', item({ description: 'the widget thing' }), null, products, aliases);
      expect(result.productId).toBe('p-alias-match');
      expect(result.method).toBe('alias_exact');
    });
  });

  it('name exact match scoped to the matched supplier outranks a global name-exact match', async () => {
    const products = [
      product({ id: 'p-global', name: 'Widget', supplier_id: 'other-supplier' }),
      product({ id: 'p-scoped', name: 'Widget', supplier_id: 'supplier-1' }),
    ];
    const result = await matchProduct({} as never, 't1', item({ description: 'Widget' }), 'supplier-1', products, []);
    expect(result).toEqual({ productId: 'p-scoped', confidence: 0.92, method: 'name_exact' });
  });

  it('falls back to global name-exact match when no supplier-scoped match exists', async () => {
    const products = [product({ id: 'p1', name: 'Widget', supplier_id: 'unrelated-supplier' })];
    const result = await matchProduct({} as never, 't1', item({ description: 'Widget' }), 'supplier-1', products, []);
    expect(result).toEqual({ productId: 'p1', confidence: 0.88, method: 'name_exact' });
  });

  it('name-exact match (priority 4) outranks SKU-partial match (priority 5) even when both would match', async () => {
    // The invoice SKU "BOX-100-CASE" contains the DB SKU "BOX-100" (a
    // partial match candidate), but the description also exactly matches
    // a *different* product's name — priority order says name-exact wins.
    const products = [
      product({ id: 'p-sku-partial', name: 'Something else entirely', sku: 'BOX-100' }),
      product({ id: 'p-name-exact', name: 'Cardboard Box', sku: 'UNRELATED' }),
    ];
    const result = await matchProduct(
      {} as never,
      't1',
      item({ description: 'Cardboard Box', sku: 'BOX-100-CASE' }),
      null,
      products,
      []
    );
    expect(result.productId).toBe('p-name-exact');
    expect(result.method).toBe('name_exact');
  });

  it('SKU partial match: extracted SKU containing the DB SKU (e.g. a barcode)', async () => {
    const products = [product({ id: 'p1', sku: 'BOX-100', name: 'Nothing Related' })];
    const result = await matchProduct(
      {} as never,
      't1',
      item({ description: 'no name overlap at all', sku: '0012BOX-1009999' }),
      null,
      products,
      []
    );
    expect(result).toEqual({ productId: 'p1', confidence: 0.9, method: 'sku_partial' });
  });

  it('name-contains match, supplier-scoped beats global', async () => {
    const products = [
      product({ id: 'p-global', name: 'Tape', supplier_id: 'other' }),
      product({ id: 'p-scoped', name: 'Tape', supplier_id: 'supplier-1' }),
    ];
    const result = await matchProduct(
      {} as never,
      't1',
      item({ description: 'Packing Tape 2-inch roll' }),
      'supplier-1',
      products,
      []
    );
    expect(result.productId).toBe('p-scoped');
    expect(result.method).toBe('name_contains');
  });

  it('name-contains requires the product name to be at least 3 characters (avoids noisy single-letter matches)', async () => {
    const products = [product({ id: 'p1', name: 'A' })];
    const result = await matchProduct({} as never, 't1', item({ description: 'A box of things' }), null, products, []);
    expect(result.method).not.toBe('name_contains');
  });

  describe('fuzzy match (last resort)', () => {
    it('matches a near-identical name above the 0.65 similarity threshold', async () => {
      const products = [product({ id: 'p1', name: 'Cardboard Boxes Medium', sku: 'X' })];
      const result = await matchProduct(
        {} as never,
        't1',
        item({ description: 'Cardboard Box Medum' }), // typo, no exact/contains match
        null,
        products,
        []
      );
      expect(result.method).toBe('name_fuzzy');
      expect(result.productId).toBe('p1');
    });

    it('a supplier match boosts fuzzy confidence by 0.05', async () => {
      const scopedProducts = [product({ id: 'p1', name: 'Cardboard Boxes Medium', supplier_id: 'supplier-1' })];
      const unscopedProducts = [product({ id: 'p1', name: 'Cardboard Boxes Medium', supplier_id: null })];

      const withSupplier = await matchProduct(
        {} as never,
        't1',
        item({ description: 'Cardboard Box Medum' }),
        'supplier-1',
        scopedProducts,
        []
      );
      const withoutSupplier = await matchProduct(
        {} as never,
        't1',
        item({ description: 'Cardboard Box Medum' }),
        null,
        unscopedProducts,
        []
      );

      expect(withSupplier.confidence).toBeGreaterThan(withoutSupplier.confidence);
    });

    it('fuzzy confidence is capped at 0.85 even for a near-perfect similarity score', async () => {
      const products = [product({ id: 'p1', name: 'Widget XL', sku: 'X' })];
      const result = await matchProduct({} as never, 't1', item({ description: 'Widget XL' }), null, products, []);
      // "Widget XL" vs "Widget XL" is actually an exact match (method
      // name_exact wins first) — use a one-character diff to land in fuzzy
      // territory while staying very close to 1.0 similarity.
      const fuzzyResult = await matchProduct({} as never, 't1', item({ description: 'Widget XM' }), null, products, []);
      expect(fuzzyResult.confidence).toBeLessThanOrEqual(0.85);
      void result;
    });

    it('does not match below the 0.65 similarity threshold', async () => {
      const products = [product({ id: 'p1', name: 'Completely Unrelated Item', sku: 'X' })];
      const result = await matchProduct({} as never, 't1', item({ description: 'Widget' }), null, products, []);
      expect(result).toEqual({ productId: null, confidence: 0, method: 'unmatched' });
    });
  });

  it('returns unmatched against an empty product catalog', async () => {
    const result = await matchProduct({} as never, 't1', item(), null, [], []);
    expect(result).toEqual({ productId: null, confidence: 0, method: 'unmatched' });
  });
});
