import { describe, it, expect } from "vitest"
import {
  applyDiscount,
  inferDiscountPercent,
  isLineTotalConsistent,
  lineTotalWithDiscount,
  DISCOUNT_TOLERANCE_CENTS,
} from "../../../utils/discountMath.ts"

describe("discountMath module", () => {
  describe("applyDiscount", () => {
    it("returns the unit price unchanged for a 0% discount", () => {
      expect(applyDiscount(10, 0)).toBe(10)
      expect(applyDiscount(7.5, 0)).toBe(7.5)
    })

    it("returns 0 for a 100% discount", () => {
      expect(applyDiscount(10, 100)).toBe(0)
      expect(applyDiscount(123.45, 100)).toBe(0)
    })

    it("applies a fractional discount and rounds to the nearest cent", () => {
      expect(applyDiscount(10, 25)).toBe(7.5)
      expect(applyDiscount(10, 12.5)).toBe(8.75)
      // 100 * 0.875 = 87.5, exact
      expect(applyDiscount(100, 12.5)).toBe(87.5)
      // 9.99 * 0.9 = 8.991 → 8.99
      expect(applyDiscount(9.99, 10)).toBe(8.99)
    })

    it("clamps an out-of-range percent into [0, 100]", () => {
      expect(applyDiscount(10, -50)).toBe(10) // negative → 0%
      expect(applyDiscount(10, 150)).toBe(0) // > 100 → 100%
    })

    it("treats null / undefined / NaN as 0% discount", () => {
      expect(applyDiscount(10, null)).toBe(10)
      expect(applyDiscount(10, undefined)).toBe(10)
      expect(applyDiscount(10, Number.NaN)).toBe(10)
      expect(applyDiscount(10, Number.POSITIVE_INFINITY)).toBe(10)
    })

    it("returns 0 for non-finite unit prices", () => {
      expect(applyDiscount(Number.NaN, 10)).toBe(0)
      expect(applyDiscount(Number.POSITIVE_INFINITY, 10)).toBe(0)
    })
  })

  describe("lineTotalWithDiscount", () => {
    it("multiplies qty by the discounted unit price", () => {
      expect(lineTotalWithDiscount(2, 10, 0)).toBe(20)
      expect(lineTotalWithDiscount(2, 10, 50)).toBe(10)
      expect(lineTotalWithDiscount(3, 9.99, 10)).toBe(26.97)
    })

    it("returns 0 when qty is non-finite", () => {
      expect(lineTotalWithDiscount(Number.NaN, 10, 0)).toBe(0)
    })

    it("returns 0 when qty is 0", () => {
      expect(lineTotalWithDiscount(0, 10, 25)).toBe(0)
    })

    it("rounds to the nearest cent", () => {
      // 7 * (10 * 0.93) = 7 * 9.30 = 65.10, exact after rounding
      expect(lineTotalWithDiscount(7, 10, 7)).toBe(65.1)
    })
  })

  describe("inferDiscountPercent", () => {
    it("infers 0% when observed equals expected", () => {
      expect(
        inferDiscountPercent({
          qty: 2,
          unitPrice: 10,
          observedLineTotal: 20,
        }),
      ).toBe(0)
    })

    it("infers 100% when observed is 0", () => {
      expect(
        inferDiscountPercent({
          qty: 2,
          unitPrice: 10,
          observedLineTotal: 0,
        }),
      ).toBe(100)
    })

    it("infers a fractional discount", () => {
      // qty 4 * price 10 = 40 expected; observed 30 → 25% off
      expect(
        inferDiscountPercent({
          qty: 4,
          unitPrice: 10,
          observedLineTotal: 30,
        }),
      ).toBe(25)
    })

    it("rounds the inferred discount to 2 decimals", () => {
      // qty 3 * price 9.99 = 29.97; observed 26.97 → 10.01% (rounded)
      const result = inferDiscountPercent({
        qty: 3,
        unitPrice: 9.99,
        observedLineTotal: 26.97,
      })
      expect(result).not.toBeNull()
      expect(result).toBeCloseTo(10.01, 2)
    })

    it("returns null when qty is non-positive", () => {
      expect(
        inferDiscountPercent({
          qty: 0,
          unitPrice: 10,
          observedLineTotal: 0,
        }),
      ).toBeNull()
      expect(
        inferDiscountPercent({
          qty: -1,
          unitPrice: 10,
          observedLineTotal: 0,
        }),
      ).toBeNull()
    })

    it("returns null when unit price is non-positive", () => {
      expect(
        inferDiscountPercent({
          qty: 1,
          unitPrice: 0,
          observedLineTotal: 0,
        }),
      ).toBeNull()
      expect(
        inferDiscountPercent({
          qty: 1,
          unitPrice: -10,
          observedLineTotal: 0,
        }),
      ).toBeNull()
    })

    it("returns null when observed is negative", () => {
      expect(
        inferDiscountPercent({
          qty: 1,
          unitPrice: 10,
          observedLineTotal: -1,
        }),
      ).toBeNull()
    })

    it("returns null when observed exceeds expected (surcharge, not discount)", () => {
      expect(
        inferDiscountPercent({
          qty: 1,
          unitPrice: 10,
          observedLineTotal: 15,
        }),
      ).toBeNull()
    })

    it("returns null for non-finite inputs", () => {
      expect(
        inferDiscountPercent({
          qty: Number.NaN,
          unitPrice: 10,
          observedLineTotal: 5,
        }),
      ).toBeNull()
      expect(
        inferDiscountPercent({
          qty: 1,
          unitPrice: Number.POSITIVE_INFINITY,
          observedLineTotal: 5,
        }),
      ).toBeNull()
      expect(
        inferDiscountPercent({
          qty: 1,
          unitPrice: 10,
          observedLineTotal: Number.NaN,
        }),
      ).toBeNull()
    })

    it("round-trips: applying then inferring gives back the original discount", () => {
      const cases: Array<{ qty: number; unitPrice: number; pct: number }> = [
        { qty: 1, unitPrice: 10, pct: 25 },
        { qty: 4, unitPrice: 25, pct: 10 },
        { qty: 2, unitPrice: 100, pct: 50 },
        { qty: 10, unitPrice: 5.5, pct: 5 },
        { qty: 6, unitPrice: 19.99, pct: 15 },
      ]
      for (const { qty, unitPrice, pct } of cases) {
        const observed = lineTotalWithDiscount(qty, unitPrice, pct)
        const inferred = inferDiscountPercent({
          qty,
          unitPrice,
          observedLineTotal: observed,
        })
        expect(inferred).not.toBeNull()
        // Allow 0.1% slack to absorb cent-rounding noise on the line total
        expect(Math.abs((inferred ?? 0) - pct)).toBeLessThanOrEqual(0.1)
      }
    })
  })

  describe("isLineTotalConsistent", () => {
    it("returns true for an exact match", () => {
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: 25,
          observedLineTotal: 15,
        }),
      ).toBe(true)
    })

    it("returns true when difference is within the default tolerance", () => {
      // expected = 15.00; observed 15.02 → within 2¢ tolerance
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: 25,
          observedLineTotal: 15.02,
        }),
      ).toBe(true)
    })

    it("returns false when difference exceeds the default tolerance", () => {
      // expected = 15.00; observed 15.03 → outside 2¢ tolerance
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: 25,
          observedLineTotal: 15.03,
        }),
      ).toBe(false)
    })

    it("respects a custom tolerance", () => {
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: 25,
          observedLineTotal: 15.05,
          toleranceCents: 5,
        }),
      ).toBe(true)
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: 25,
          observedLineTotal: 15.06,
          toleranceCents: 5,
        }),
      ).toBe(false)
    })

    it("treats null/undefined discount as 0% (matches applyDiscount semantics)", () => {
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: null,
          observedLineTotal: 20,
        }),
      ).toBe(true)
      expect(
        isLineTotalConsistent({
          qty: 2,
          unitPrice: 10,
          discountPercent: undefined,
          observedLineTotal: 20,
        }),
      ).toBe(true)
    })
  })

  describe("DISCOUNT_TOLERANCE_CENTS", () => {
    it("preserves the historical 2-cent threshold", () => {
      expect(DISCOUNT_TOLERANCE_CENTS).toBe(2)
    })
  })
})
