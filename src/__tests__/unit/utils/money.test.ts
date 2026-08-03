import { describe, it, expect } from "vitest"
import { moneyEquals, roundToCent } from "../../../utils/money.ts"

describe("money module", () => {
  describe("roundToCent", () => {
    it("rounds standard fractional cents to the nearest cent", () => {
      expect(roundToCent(1.234)).toBe(1.23)
      expect(roundToCent(1.235)).toBe(1.24)
      expect(roundToCent(1.999)).toBe(2)
    })

    it("handles the classic float boundary case (1.005 → 1.01, not 1.00)", () => {
      expect(roundToCent(1.005)).toBe(1.01)
      expect(roundToCent(2.005)).toBe(2.01)
    })

    it("preserves zero", () => {
      expect(roundToCent(0)).toBe(0)
    })

    it("rounds negatives away from zero (matches accounting convention)", () => {
      expect(roundToCent(-1.235)).toBe(-1.24)
      expect(roundToCent(-1.005)).toBe(-1.01)
    })

    it("returns 0 for non-finite inputs instead of propagating garbage", () => {
      expect(roundToCent(NaN)).toBe(0)
      expect(roundToCent(Infinity)).toBe(0)
      expect(roundToCent(-Infinity)).toBe(0)
    })

    it("leaves already-rounded values unchanged", () => {
      expect(roundToCent(10)).toBe(10)
      expect(roundToCent(10.5)).toBe(10.5)
      expect(roundToCent(10.55)).toBe(10.55)
    })
  })

  describe("moneyEquals", () => {
    it("treats values that round to the same cent as equal", () => {
      expect(moneyEquals(1.005, 1.01)).toBe(true)
      expect(moneyEquals(1.0049999, 1.005)).toBe(true)
    })

    it("treats values one cent apart as equal by default", () => {
      expect(moneyEquals(10.0, 10.01)).toBe(true)
      expect(moneyEquals(10.0, 10.02)).toBe(false)
    })

    it("respects a custom tolerance", () => {
      expect(moneyEquals(10.0, 10.05, 5)).toBe(true)
      expect(moneyEquals(10.0, 10.06, 5)).toBe(false)
    })

    it("works for negatives", () => {
      expect(moneyEquals(-1.005, -1.01)).toBe(true)
      expect(moneyEquals(-10.0, -10.02)).toBe(false)
    })

    it("returns false when comparing against NaN", () => {
      // NaN rounds to 0, so comparing NaN to 0 will appear equal, but to any
      // non-zero amount should not. This test documents the behavior.
      expect(moneyEquals(NaN, 0)).toBe(true)
      expect(moneyEquals(NaN, 5)).toBe(false)
    })
  })
})
