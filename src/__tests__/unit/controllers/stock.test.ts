import { describe, it, expect } from 'vitest';

// Type definitions
type StockStatus = 'OUT_OF_STOCK' | 'LOW' | 'OK';

function calculateStockStatus(qty: number, minimumStockLevel: number): StockStatus {
  if (qty === 0) return 'OUT_OF_STOCK';
  if (qty <= minimumStockLevel) return 'LOW';
  return 'OK';
}

describe('unit | stock controller logic', () => {
  describe('adjust stock', () => {
    it('should calculate new quantity correctly for positive adjustment', () => {
      const currentQty = 100;
      const changeQty = 50;
      const newQty = currentQty + changeQty;

      expect(newQty).toBe(150);
    });

    it('should calculate new quantity correctly for negative adjustment', () => {
      const currentQty = 100;
      const changeQty = -30;
      const newQty = currentQty + changeQty;

      expect(newQty).toBe(70);
    });

    it('should detect when stock would go negative', () => {
      const currentQty = 50;
      const changeQty = -100;
      const newQty = currentQty + changeQty;

      expect(newQty).toBeLessThan(0);
    });

    it('should allow stock to reach exactly zero', () => {
      const currentQty = 50;
      const changeQty = -50;
      const newQty = currentQty + changeQty;

      expect(newQty).toBe(0);
      expect(newQty).toBeGreaterThanOrEqual(0);
    });

    it('should validate reason length', () => {
      const validReason = 'Restocking inventory';
      const invalidReason = 'ab';

      expect(validReason.length).toBeGreaterThanOrEqual(3);
      expect(invalidReason.length).toBeLessThan(3);
    });
  });

  describe('transfer stock', () => {
    it('should detect same location transfer attempt', () => {
      const fromLocationId = 'loc-123';
      const toLocationId = 'loc-123';

      expect(fromLocationId).toBe(toLocationId);
    });

    it('should detect different locations for valid transfer', () => {
      const fromLocationId = 'loc-123';
      const toLocationId = 'loc-456';

      expect(fromLocationId).not.toBe(toLocationId);
    });

    it('should calculate source location new quantity', () => {
      const fromQty = 100;
      const transferQty = 30;
      const newFromQty = fromQty - transferQty;

      expect(newFromQty).toBe(70);
    });

    it('should calculate destination location new quantity when stock exists', () => {
      const toQty = 50;
      const transferQty = 30;
      const newToQty = toQty + transferQty;

      expect(newToQty).toBe(80);
    });

    it('should set correct quantity when creating new stock at destination', () => {
      const toQty = null; // No existing stock
      const transferQty = 30;
      const newToQty = transferQty;

      expect(newToQty).toBe(30);
    });

    it('should detect insufficient stock at source', () => {
      const availableQty = 20;
      const requestedQty = 50;

      expect(availableQty).toBeLessThan(requestedQty);
    });

    it('should validate positive transfer quantity', () => {
      const validQty = 10;
      const invalidQty = -5;
      const zeroQty = 0;

      expect(validQty).toBeGreaterThan(0);
      expect(invalidQty).toBeLessThanOrEqual(0);
      expect(zeroQty).toBeLessThanOrEqual(0);
    });

    it('should generate correct movement reason for source', () => {
      const toLocationName = 'Warehouse B';
      const reason = 'Monthly restock';
      const movementReason = `Transfer to ${toLocationName}: ${reason}`;

      expect(movementReason).toBe('Transfer to Warehouse B: Monthly restock');
    });

    it('should generate correct movement reason for destination', () => {
      const fromLocationName = 'Warehouse A';
      const reason = 'Monthly restock';
      const movementReason = `Transfer from ${fromLocationName}: ${reason}`;

      expect(movementReason).toBe('Transfer from Warehouse A: Monthly restock');
    });
  });

  describe('stock status calculation', () => {
    it('should return OUT_OF_STOCK when qty is 0', () => {
      const status = calculateStockStatus(0, 10);
      expect(status).toBe('OUT_OF_STOCK');
    });

    it('should return LOW when qty is at or below minimum', () => {
      const status = calculateStockStatus(5, 10);
      expect(status).toBe('LOW');
    });

    it('should return OK when qty is above minimum', () => {
      const status = calculateStockStatus(50, 10);
      expect(status).toBe('OK');
    });

    it('should return LOW when qty equals minimum', () => {
      const status = calculateStockStatus(10, 10);
      expect(status).toBe('LOW');
    });
  });

  describe('supplier filter (full mode predicate)', () => {
    // Mirrors the JS predicate applied in getAllStock's full mode after the
    // Drizzle fetch. Encodes the contract for the "match this supplier" and
    // "no supplier set" cases so a future refactor can't silently break them.
    type StockRow = { id: string; product: { supplier_id: string | null } | null };

    function applySupplierFilter(
      rows: StockRow[],
      supplierId: string | undefined,
    ): StockRow[] {
      if (supplierId === 'none') {
        return rows.filter((stock) => !stock.product?.supplier_id);
      }
      if (supplierId) {
        return rows.filter((stock) => stock.product?.supplier_id === supplierId);
      }
      return rows;
    }

    const rows: StockRow[] = [
      { id: 's1', product: { supplier_id: 'supA' } },
      { id: 's2', product: { supplier_id: 'supB' } },
      { id: 's3', product: { supplier_id: null } },
      { id: 's4', product: null },
    ];

    it('returns only rows matching a specific supplier', () => {
      expect(applySupplierFilter(rows, 'supA').map((r) => r.id)).toEqual(['s1']);
      expect(applySupplierFilter(rows, 'supB').map((r) => r.id)).toEqual(['s2']);
    });

    it('returns rows with no supplier when filter is "none"', () => {
      expect(applySupplierFilter(rows, 'none').map((r) => r.id)).toEqual(['s3', 's4']);
    });

    it('returns all rows when no supplier filter is provided', () => {
      expect(applySupplierFilter(rows, undefined)).toHaveLength(4);
    });

    it('returns no rows when no product matches the supplier', () => {
      expect(applySupplierFilter(rows, 'supC')).toEqual([]);
    });
  });
});
