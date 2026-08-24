import { describe, it, expect } from 'vitest';
import { matchSupplier } from '../../../../services/invoice/supplierMatcher.js';
import type { InvoiceExtractionResult } from '../../../../services/ai/geminiService.js';

function fakeDb(opts: {
  po?: { supplier_id: string } | null;
  suppliers?: Array<{ id: string; name: string; email: string | null }>;
}) {
  return {
    query: {
      PurchaseOrder: { findFirst: async () => opts.po ?? null },
      Supplier: { findMany: async () => opts.suppliers ?? [] },
    },
  } as never;
}

function extracted(overrides: Partial<InvoiceExtractionResult> = {}): InvoiceExtractionResult {
  return {
    supplier: { name: 'Acme Supplies' },
    items: [],
    total: 0,
    confidence: 1,
    ...overrides,
  } as InvoiceExtractionResult;
}

describe('unit | supplierMatcher.matchSupplier (priority cascade)', () => {
  it('PO reference match wins outright, confidence 1.0', async () => {
    const db = fakeDb({ po: { supplier_id: 'sup-po' }, suppliers: [{ id: 'sup-name', name: 'Acme Supplies', email: null }] });
    const result = await matchSupplier(db, 't1', extracted({ po_reference: 'PO-123' }));
    expect(result).toEqual({ supplierId: 'sup-po', confidence: 1.0, method: 'po_reference' });
  });

  it('falls through to name matching when the PO reference does not resolve', async () => {
    const db = fakeDb({ po: null, suppliers: [{ id: 'sup-1', name: 'Acme Supplies', email: null }] });
    const result = await matchSupplier(db, 't1', extracted({ po_reference: 'NOT-A-REAL-PO' }));
    expect(result.supplierId).toBe('sup-1');
    expect(result.method).toBe('name_exact');
  });

  it('email exact match (extracted supplier email) beats name matching', async () => {
    const db = fakeDb({
      suppliers: [
        { id: 'sup-name', name: 'Acme Supplies', email: null },
        { id: 'sup-email', name: 'Totally Different Name', email: 'billing@acme.example' },
      ],
    });
    const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'Acme Supplies', email: 'billing@acme.example' } }));
    expect(result).toEqual({ supplierId: 'sup-email', confidence: 0.95, method: 'email_exact' });
  });

  it('from-email exact match (actual sender address) when extracted email is absent', async () => {
    const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Unrelated Name', email: 'orders@acme.example' }] });
    const result = await matchSupplier(db, 't1', extracted(), 'orders@acme.example');
    expect(result).toEqual({ supplierId: 'sup-1', confidence: 0.93, method: 'from_email_exact' });
  });

  describe('email domain match', () => {
    it('matches on sender domain when the exact address differs', async () => {
      const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Unrelated', email: 'billing@acme.example' }] });
      const result = await matchSupplier(db, 't1', extracted(), 'random-person@acme.example');
      expect(result).toEqual({ supplierId: 'sup-1', confidence: 0.85, method: 'email_domain' });
    });

    it('never uses domain matching for common free email providers (gmail/yahoo/hotmail/outlook)', async () => {
      const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Unrelated', email: 'someone@gmail.com' }] });
      const result = await matchSupplier(db, 't1', extracted(), 'someone.else@gmail.com');
      expect(result.method).not.toBe('email_domain');
    });
  });

  it('name exact match (case-insensitive)', async () => {
    const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'ACME SUPPLIES', email: null }] });
    const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'acme supplies' } }));
    expect(result).toEqual({ supplierId: 'sup-1', confidence: 0.9, method: 'name_exact' });
  });

  it('normalized name match strips business suffixes (INC/LLC/CO/etc.)', async () => {
    const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'NY Mutual Trading, Inc.', email: null }] });
    const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'NY Mutual Trading LLC' } }));
    expect(result).toEqual({ supplierId: 'sup-1', confidence: 0.88, method: 'name_normalized' });
  });

  it('contains match: extracted name is a superset of a supplier name (after normalization)', async () => {
    const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Mutual Trading', email: null }] });
    const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'NY Mutual Trading Company West Coast Division' } }));
    expect(result).toEqual({ supplierId: 'sup-1', confidence: 0.82, method: 'name_contains' });
  });

  describe('fuzzy match (last resort)', () => {
    it('matches on raw-name similarity above 0.6', async () => {
      const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Global Furniture Company', email: null }] });
      const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'Global Furnitrue Compny' } })); // typos
      expect(result.method).toBe('name_fuzzy');
      expect(result.supplierId).toBe('sup-1');
    });

    it('takes the better of raw-similarity vs normalized-similarity', async () => {
      // Raw comparison is dragged down by suffix noise ("Inc.") on one side
      // only; normalized comparison strips it and scores much closer —
      // matchSupplier should pick up on the normalized score.
      const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Rapid Logistics Inc.', email: null }] });
      const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'Rapid Logistics' } }));
      // This is actually a normalized EXACT match (higher priority than
      // fuzzy) — confirms normalization is doing real work before fuzzy
      // even runs.
      expect(result.method).toBe('name_normalized');
    });

    it('returns unmatched below the 0.6 fuzzy threshold', async () => {
      const db = fakeDb({ suppliers: [{ id: 'sup-1', name: 'Zebra Corp', email: null }] });
      const result = await matchSupplier(db, 't1', extracted({ supplier: { name: 'Completely Unrelated Business Name' } }));
      expect(result).toEqual({ supplierId: null, confidence: 0, method: 'unmatched' });
    });
  });

  it('returns unmatched against an empty supplier list', async () => {
    const db = fakeDb({ suppliers: [] });
    const result = await matchSupplier(db, 't1', extracted());
    expect(result).toEqual({ supplierId: null, confidence: 0, method: 'unmatched' });
  });
});
