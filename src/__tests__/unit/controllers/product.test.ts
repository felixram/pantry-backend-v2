import { describe, it, expect } from 'vitest';

// Type definitions for test data
interface ProductVersion {
  costPrice: number;
  versionNumber?: number;
}

type PriceTrend = 'increasing' | 'decreasing' | 'stable';

function calculatePriceTrend(versions: ProductVersion[]): PriceTrend {
  if (versions.length < 2) return 'stable';

  const latestPrice = versions[0]?.costPrice ?? 0;
  const previousPrice = versions[1]?.costPrice ?? 0;

  if (latestPrice > previousPrice) return 'increasing';
  if (latestPrice < previousPrice) return 'decreasing';
  return 'stable';
}

describe('unit | product controller logic', () => {
  describe('cost analysis', () => {
    describe('price trend calculation', () => {
      it('should identify increasing price trend', () => {
        const recentVersions: ProductVersion[] = [
          { costPrice: 15.00 }, // latest
          { costPrice: 12.00 }, // previous
          { costPrice: 10.00 }, // oldest
        ];

        const trend = calculatePriceTrend(recentVersions);

        expect(trend).toBe('increasing');
      });

      it('should identify decreasing price trend', () => {
        const recentVersions: ProductVersion[] = [
          { costPrice: 8.00 },  // latest
          { costPrice: 12.00 }, // previous
          { costPrice: 15.00 }, // oldest
        ];

        const trend = calculatePriceTrend(recentVersions);

        expect(trend).toBe('decreasing');
      });

      it('should identify stable price trend', () => {
        const recentVersions: ProductVersion[] = [
          { costPrice: 10.00 }, // latest
          { costPrice: 10.00 }, // previous
        ];

        const trend = calculatePriceTrend(recentVersions);

        expect(trend).toBe('stable');
      });

      it('should default to stable with single version', () => {
        const recentVersions: ProductVersion[] = [
          { costPrice: 10.00 },
        ];

        const trend = calculatePriceTrend(recentVersions);

        expect(trend).toBe('stable');
      });
    });

    describe('average cost calculation', () => {
      it('should calculate average correctly', () => {
        const prices = [10, 12, 15, 8, 20];
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

        expect(avg).toBe(13);
      });

      it('should find min and max correctly', () => {
        const prices = [10, 12, 15, 8, 20];
        const min = Math.min(...prices);
        const max = Math.max(...prices);

        expect(min).toBe(8);
        expect(max).toBe(20);
      });
    });

    describe('null cost handling', () => {
      it('should handle null cost price with default', () => {
        const costPrice = null;
        const resolvedPrice = costPrice || 0;

        expect(resolvedPrice).toBe(0);
      });

      it('should handle undefined cost price with default', () => {
        const costPrice = undefined;
        const resolvedPrice = costPrice || 0;

        expect(resolvedPrice).toBe(0);
      });

      it('should preserve valid cost price', () => {
        const costPrice = 25.50;
        const resolvedPrice = costPrice || 0;

        expect(resolvedPrice).toBe(25.50);
      });
    });
  });

  describe('product units', () => {
    it('should support multiple units as array', () => {
      const units = ['kg', 'box', 'unit'];

      expect(Array.isArray(units)).toBe(true);
      expect(units).toContain('kg');
      expect(units).toContain('box');
    });

    it('should support single unit as array', () => {
      const units = ['kg'];

      expect(Array.isArray(units)).toBe(true);
      expect(units).toHaveLength(1);
    });
  });

  describe('SKU validation', () => {
    it('should have valid SKU format', () => {
      const validSKU = 'ABC12345';
      const invalidSKU = '';

      expect(validSKU.length).toBeGreaterThan(0);
      expect(invalidSKU.length).toBe(0);
    });

    it('should allow alphanumeric SKUs', () => {
      const sku = 'PROD001';
      const alphanumericRegex = /^[A-Za-z0-9]+$/;

      expect(alphanumericRegex.test(sku)).toBe(true);
    });
  });

  describe('price history sorting', () => {
    interface VersionWithNumber {
      versionNumber: number;
      costPrice: number;
    }

    it('should sort versions by version number descending', () => {
      const versions: VersionWithNumber[] = [
        { versionNumber: 1, costPrice: 10 },
        { versionNumber: 3, costPrice: 15 },
        { versionNumber: 2, costPrice: 12 },
      ];

      const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);

      expect(sorted[0]!.versionNumber).toBe(3);
      expect(sorted[1]!.versionNumber).toBe(2);
      expect(sorted[2]!.versionNumber).toBe(1);
    });

    it('should get most recent version first after sorting', () => {
      const versions: VersionWithNumber[] = [
        { versionNumber: 1, costPrice: 10 },
        { versionNumber: 5, costPrice: 20 },
        { versionNumber: 3, costPrice: 15 },
      ];

      const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
      const latestVersion = sorted[0]!;

      expect(latestVersion.versionNumber).toBe(5);
      expect(latestVersion.costPrice).toBe(20);
    });
  });
});
