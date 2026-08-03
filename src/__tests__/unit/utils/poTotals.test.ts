import { describe, it, expect } from "vitest"
import {
  calculateLineTotal,
  calculateSubtotal,
  calculateTaxFromItems,
  calculateLineTax,
  calculateShippingFee,
  calculateGrandTotal,
  type POItemForTotals,
} from "../../../utils/poTotals.ts"

const item = (overrides: Partial<POItemForTotals>): POItemForTotals => ({
  qty: 1,
  unit_price: 0,
  ...overrides,
})

describe("poTotals", () => {
  describe("calculateLineTotal", () => {
    it("multiplies qty by unit_price and rounds to the cent", () => {
      expect(calculateLineTotal(item({ qty: 3, unit_price: 2.5 }))).toBe(7.5)
      expect(calculateLineTotal(item({ qty: 2, unit_price: 1.235 }))).toBe(2.47)
    })

    it("treats null unit_price as zero", () => {
      expect(calculateLineTotal(item({ qty: 4, unit_price: null }))).toBe(0)
    })

    it("does NOT substitute received_qty by default", () => {
      expect(
        calculateLineTotal(item({ qty: 10, unit_price: 5, received_qty: 8 })),
      ).toBe(50)
    })

    it("substitutes received_qty when useReceived is true and received_qty is set", () => {
      expect(
        calculateLineTotal(
          item({ qty: 10, unit_price: 5, received_qty: 8 }),
          { useReceived: true },
        ),
      ).toBe(40)
    })

    it("falls back to qty when useReceived is true but received_qty is null", () => {
      expect(
        calculateLineTotal(
          item({ qty: 10, unit_price: 5, received_qty: null }),
          { useReceived: true },
        ),
      ).toBe(50)
    })

    it("returns 0 for non-finite inputs rather than NaN", () => {
      expect(calculateLineTotal(item({ qty: NaN, unit_price: 5 }))).toBe(0)
      expect(calculateLineTotal(item({ qty: 5, unit_price: Infinity }))).toBe(0)
    })
  })

  describe("calculateSubtotal", () => {
    it("sums line products of mixed items", () => {
      const items = [
        item({ qty: 2, unit_price: 1.5 }),
        item({ qty: 3, unit_price: 4 }),
        item({ qty: 1, unit_price: 9.99 }),
      ]
      expect(calculateSubtotal(items)).toBe(24.99)
    })

    it("returns 0 for an empty list", () => {
      expect(calculateSubtotal([])).toBe(0)
    })

    it("rounds once at the end, not per line (3 × 0.333 → 1.00, not 0.99)", () => {
      // Three lines each computing to 0.333 → per-line rounding would give
      // 0.33 + 0.33 + 0.33 = 0.99. End-of-sum rounding gives 1.00.
      const items = [
        item({ qty: 1, unit_price: 0.333 }),
        item({ qty: 1, unit_price: 0.333 }),
        item({ qty: 1, unit_price: 0.334 }),
      ]
      expect(calculateSubtotal(items)).toBe(1)
    })

    it("uses received_qty when useReceived option is on", () => {
      const items = [
        item({ qty: 10, unit_price: 5, received_qty: 8 }),
        item({ qty: 4, unit_price: 2.5, received_qty: 4 }),
      ]
      expect(calculateSubtotal(items, { useReceived: true })).toBe(50)
      expect(calculateSubtotal(items)).toBe(60)
    })

    it("tolerates null unit_price across the list", () => {
      const items = [
        item({ qty: 2, unit_price: null }),
        item({ qty: 3, unit_price: 4 }),
      ]
      expect(calculateSubtotal(items)).toBe(12)
    })
  })

  describe("calculateTaxFromItems", () => {
    it("sums per-line tax.taxAmount values", () => {
      const items: POItemForTotals[] = [
        item({ qty: 1, unit_price: 10, tax: { taxAmount: 1.5, isTaxable: true } }),
        item({ qty: 1, unit_price: 20, tax: { taxAmount: 3, isTaxable: true } }),
        item({ qty: 1, unit_price: 5, tax: null }),
      ]
      expect(calculateTaxFromItems(items)).toBe(4.5)
    })

    it("returns 0 when no items carry a tax amount", () => {
      const items = [
        item({ qty: 1, unit_price: 10 }),
        item({ qty: 1, unit_price: 20, tax: null }),
      ]
      expect(calculateTaxFromItems(items)).toBe(0)
    })

    it("ignores null/undefined taxAmount values", () => {
      const items: POItemForTotals[] = [
        item({ qty: 1, unit_price: 10, tax: { taxAmount: null } }),
        item({ qty: 1, unit_price: 10, tax: { taxAmount: 2 } }),
      ]
      expect(calculateTaxFromItems(items)).toBe(2)
    })
  })

  describe("calculateLineTax", () => {
    it("applies a percentage rate to a line total", () => {
      expect(calculateLineTax(100, 10)).toBe(10)
      expect(calculateLineTax(50, 7.5)).toBe(3.75)
    })

    it("returns 0 for non-positive rates", () => {
      expect(calculateLineTax(100, 0)).toBe(0)
      expect(calculateLineTax(100, -5)).toBe(0)
    })

    it("rounds the result to the cent", () => {
      // 33.33 * 7% = 2.3331 → 2.33
      expect(calculateLineTax(33.33, 7)).toBe(2.33)
    })

    it("matches tax-from-items when both paths describe the same line", () => {
      const lineTotal = calculateLineTotal(item({ qty: 4, unit_price: 12.5 })) // 50
      const taxViaRate = calculateLineTax(lineTotal, 8.25) // 4.125 → 4.13
      const taxViaItems = calculateTaxFromItems([
        item({ qty: 4, unit_price: 12.5, tax: { taxAmount: taxViaRate } }),
      ])
      expect(taxViaItems).toBe(taxViaRate)
      expect(taxViaRate).toBe(4.13)
    })
  })

  describe("calculateShippingFee", () => {
    it("charges the fee when subtotal is below the minimum", () => {
      expect(calculateShippingFee(50, 100, 10)).toBe(10)
    })

    it("waives the fee when subtotal exactly meets the minimum", () => {
      expect(calculateShippingFee(100, 100, 10)).toBe(0)
    })

    it("waives the fee when subtotal is above the minimum", () => {
      expect(calculateShippingFee(150, 100, 10)).toBe(0)
    })

    it("returns 0 when the minimum is null/missing", () => {
      expect(calculateShippingFee(50, null, 10)).toBe(0)
      expect(calculateShippingFee(50, undefined, 10)).toBe(0)
    })

    it("returns 0 when the fee is null/missing", () => {
      expect(calculateShippingFee(50, 100, null)).toBe(0)
      expect(calculateShippingFee(50, 100, undefined)).toBe(0)
    })

    it("returns 0 when either minimum or fee is non-positive", () => {
      expect(calculateShippingFee(50, 0, 10)).toBe(0)
      expect(calculateShippingFee(50, 100, 0)).toBe(0)
      expect(calculateShippingFee(50, -10, 10)).toBe(0)
    })
  })

  describe("calculateGrandTotal", () => {
    it("sums subtotal + tax + shipping", () => {
      expect(
        calculateGrandTotal({ subtotal: 100, tax: 8.25, shipping: 5 }),
      ).toBe(113.25)
    })

    it("rounds the final sum to the cent", () => {
      expect(
        calculateGrandTotal({ subtotal: 0.1, tax: 0.2, shipping: 0 }),
      ).toBe(0.3)
    })

    it("treats non-finite inputs as 0", () => {
      expect(
        calculateGrandTotal({ subtotal: NaN, tax: 5, shipping: 5 }),
      ).toBe(10)
    })
  })

  describe("rounding contract", () => {
    it("single-line totals always come back rounded", () => {
      // 7 * 0.142857 = 0.999999 → 1.00
      const total = calculateLineTotal(item({ qty: 7, unit_price: 0.142857 }))
      expect(total).toBe(1)
    })

    it("subtotal rounds once at the end (matches receipt arithmetic)", () => {
      // 50 lines of 0.015 → raw sum 0.75; if each line rounded first to 0.02
      // then re-summed, we'd get 1.00.
      const items: POItemForTotals[] = Array.from({ length: 50 }, () =>
        item({ qty: 1, unit_price: 0.015 }),
      )
      expect(calculateSubtotal(items)).toBe(0.75)
    })
  })
})
