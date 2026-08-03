import { describe, it, expect } from "vitest"
import {
  UnitConversionError,
  allUnitPrices,
  findBaseUnit,
  findUnit,
  formatQty,
  fromBaseUnits,
  getBaseUnitCost,
  getFactor,
  priceInUnit,
  toBaseUnits,
  tryGetFactor,
  type UnitConversion,
} from "../../../utils/unitConversion.ts"

const conversions: UnitConversion[] = [
  { unit_name: "Unit", conversion_factor: 1, is_base_unit: true },
  { unit_name: "Sleeve", conversion_factor: 20, is_base_unit: false },
  { unit_name: "Case", conversion_factor: 240, is_base_unit: false },
]

describe("unitConversion module", () => {
  describe("findBaseUnit / findUnit", () => {
    it("returns the base unit", () => {
      expect(findBaseUnit(conversions)?.unit_name).toBe("Unit")
    })

    it("returns undefined when no base unit is defined", () => {
      expect(findBaseUnit([])).toBeUndefined()
    })

    it("finds a unit by name", () => {
      expect(findUnit(conversions, "Case")?.conversion_factor).toBe(240)
    })

    it("returns undefined for an unknown unit", () => {
      expect(findUnit(conversions, "Pallet")).toBeUndefined()
    })
  })

  describe("getFactor", () => {
    it("returns the conversion factor", () => {
      expect(getFactor(conversions, "Sleeve")).toBe(20)
    })

    it("throws UnitConversionError when the unit is missing", () => {
      expect(() => getFactor(conversions, "Pallet")).toThrow(UnitConversionError)
    })

    it("includes the available unit names in the error", () => {
      try {
        getFactor(conversions, "Pallet")
      } catch (e) {
        expect((e as Error).message).toContain("Pallet")
        expect((e as Error).message).toContain("Case")
      }
    })
  })

  describe("tryGetFactor", () => {
    it("returns the factor when found", () => {
      expect(tryGetFactor(conversions, "Case")).toBe(240)
    })

    it("returns undefined when the unit is missing", () => {
      expect(tryGetFactor(conversions, "Pallet")).toBeUndefined()
    })

    it("returns undefined for nullish inputs", () => {
      expect(tryGetFactor(null, "Case")).toBeUndefined()
      expect(tryGetFactor(conversions, null)).toBeUndefined()
      expect(tryGetFactor(undefined, undefined)).toBeUndefined()
    })
  })

  describe("toBaseUnits / fromBaseUnits", () => {
    it("converts to base units", () => {
      expect(toBaseUnits(5, conversions, "Case")).toBe(1200)
    })

    it("converts from base units", () => {
      expect(fromBaseUnits(1200, conversions, "Case")).toBe(5)
    })

    it("round-trips a value through both directions", () => {
      const original = 3
      const baseQty = toBaseUnits(original, conversions, "Sleeve")
      expect(fromBaseUnits(baseQty, conversions, "Sleeve")).toBe(original)
    })

    it("throws when the unit is missing", () => {
      expect(() => toBaseUnits(1, conversions, "Pallet")).toThrow(UnitConversionError)
      expect(() => fromBaseUnits(1, conversions, "Pallet")).toThrow(UnitConversionError)
    })
  })

  describe("priceInUnit", () => {
    it("converts a base-unit price to a non-base unit", () => {
      // $1 per Unit → $240 per Case
      expect(
        priceInUnit({ price: 1, fromUnit: "Unit", toUnit: "Case", conversions }),
      ).toBe(240)
    })

    it("converts a Case price to a Sleeve price", () => {
      // $240 per Case (factor 240) → per-base = 1 → per-Sleeve (factor 20) = 20
      expect(
        priceInUnit({ price: 240, fromUnit: "Case", toUnit: "Sleeve", conversions }),
      ).toBe(20)
    })

    it("treats null fromUnit as the base unit", () => {
      // $0.50 per base unit → per-Case = $0.50 × 240 = $120
      expect(
        priceInUnit({ price: 0.5, fromUnit: null, toUnit: "Case", conversions }),
      ).toBe(120)
    })

    it("returns identity when fromUnit === toUnit", () => {
      expect(
        priceInUnit({ price: 99, fromUnit: "Sleeve", toUnit: "Sleeve", conversions }),
      ).toBe(99)
    })

    it("throws when either unit is missing", () => {
      expect(() =>
        priceInUnit({ price: 1, fromUnit: "Pallet", toUnit: "Case", conversions }),
      ).toThrow(UnitConversionError)
      expect(() =>
        priceInUnit({ price: 1, fromUnit: "Case", toUnit: "Pallet", conversions }),
      ).toThrow(UnitConversionError)
    })
  })

  describe("getBaseUnitCost", () => {
    it("divides the price by the unit's factor", () => {
      // $24 per Case (factor 240) → $0.10 per base unit
      expect(getBaseUnitCost(24, conversions, "Case")).toBe(0.1)
    })

    it("returns the price unchanged when unitName is null (already per base unit)", () => {
      expect(getBaseUnitCost(7, conversions, null)).toBe(7)
    })

    it("throws when the unit is missing", () => {
      expect(() => getBaseUnitCost(1, conversions, "Pallet")).toThrow(UnitConversionError)
    })
  })

  describe("allUnitPrices", () => {
    it("derives every unit's price from one entered price", () => {
      const result = allUnitPrices(24, "Case", conversions)
      expect(result).not.toBeNull()
      const byName = Object.fromEntries(result!.map((p) => [p.unit_name, p.price]))
      expect(byName.Unit).toBe(0.1)
      expect(byName.Sleeve).toBe(2)
      expect(byName.Case).toBe(24)
    })

    it("marks the entered unit and the base unit", () => {
      const result = allUnitPrices(24, "Case", conversions)!
      const entered = result.find((p) => p.is_entered_unit)
      const base = result.find((p) => p.is_base_unit)
      expect(entered?.unit_name).toBe("Case")
      expect(base?.unit_name).toBe("Unit")
    })

    it("treats null enteredUnit as the base unit", () => {
      const result = allUnitPrices(0.1, null, conversions)!
      expect(result.find((p) => p.is_entered_unit)?.unit_name).toBe("Unit")
      expect(result.find((p) => p.unit_name === "Case")?.price).toBe(24)
    })

    it("returns null when conversions are empty", () => {
      expect(allUnitPrices(1, "Case", [])).toBeNull()
    })

    it("returns null when there is no base unit", () => {
      const noBase: UnitConversion[] = [
        { unit_name: "Case", conversion_factor: 240, is_base_unit: false },
      ]
      expect(allUnitPrices(1, "Case", noBase)).toBeNull()
    })

    it("returns null when the entered unit isn't in conversions", () => {
      expect(allUnitPrices(1, "Pallet", conversions)).toBeNull()
    })
  })

  describe("formatQty", () => {
    it("converts a base qty to a display unit", () => {
      const out = formatQty(1200, conversions, "Case")
      expect(out.qty).toBe(5)
      expect(out.unit).toBe("Case")
      expect(out.label).toBe("5 Case")
    })

    it("falls back to the base unit when displayUnit is null", () => {
      const out = formatQty(48, conversions)
      expect(out.unit).toBe("Unit")
      expect(out.qty).toBe(48)
    })

    it("falls back to the base unit when displayUnit is unknown", () => {
      const out = formatQty(48, conversions, "Pallet")
      expect(out.unit).toBe("Unit")
      expect(out.qty).toBe(48)
    })

    it("returns the raw qty when there are no conversions at all", () => {
      const out = formatQty(48, [])
      expect(out.qty).toBe(48)
      expect(out.unit).toBe("")
    })
  })
})
