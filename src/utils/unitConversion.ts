// ============================================================================
// SINGLE SOURCE OF TRUTH FOR UNIT CONVERSIONS
//
// This file is mirrored at client/src/lib/unitConversion.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
// ============================================================================

export interface UnitConversion {
  unit_name: string
  conversion_factor: number
  is_base_unit: boolean
  is_purchasable?: boolean
}

export interface UnitPrice {
  unit_name: string
  price: number
  is_base_unit: boolean
  is_entered_unit: boolean
}

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnitConversionError"
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findBaseUnit(
  conversions: readonly UnitConversion[],
): UnitConversion | undefined {
  return conversions.find((c) => c.is_base_unit)
}

export function findUnit(
  conversions: readonly UnitConversion[],
  unitName: string,
): UnitConversion | undefined {
  return conversions.find((c) => c.unit_name === unitName)
}

/**
 * Get the conversion factor for a unit. Throws if the unit is not found.
 * Use this in code paths where a missing unit is a bug (e.g. server mutations,
 * money math). Prefer this over `tryGetFactor` whenever possible.
 */
export function getFactor(
  conversions: readonly UnitConversion[],
  unitName: string,
): number {
  const conv = findUnit(conversions, unitName)
  if (!conv) {
    throw new UnitConversionError(
      `Unit "${unitName}" not found in conversions [${conversions
        .map((c) => c.unit_name)
        .join(", ")}]`,
    )
  }
  return conv.conversion_factor
}

/**
 * Get the conversion factor for a unit, or `undefined` if not found.
 * Use this only when the caller has a sensible fallback for missing units
 * (e.g. UI rendering before conversions have loaded).
 */
export function tryGetFactor(
  conversions: readonly UnitConversion[] | undefined | null,
  unitName: string | undefined | null,
): number | undefined {
  if (!conversions || !unitName) return undefined
  return findUnit(conversions, unitName)?.conversion_factor
}

// ---------------------------------------------------------------------------
// Quantity conversion
// ---------------------------------------------------------------------------

/**
 * Convert a quantity from `unitName` to base units.
 * Example: 5 Cases (factor 24) → 120 base units.
 */
export function toBaseUnits(
  qty: number,
  conversions: readonly UnitConversion[],
  unitName: string,
): number {
  return qty * getFactor(conversions, unitName)
}

/**
 * Convert a base-unit quantity to `unitName`.
 * Example: 120 base units (factor 24) → 5 Cases.
 */
export function fromBaseUnits(
  baseQty: number,
  conversions: readonly UnitConversion[],
  unitName: string,
): number {
  return baseQty / getFactor(conversions, unitName)
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Convert a price expressed per `fromUnit` into a price expressed per `toUnit`.
 *
 * `fromUnit` is the unit the input price is denominated in. `null`/`undefined`
 * means "the base unit" — this matches how `costPriceUnit`/`sellingPriceUnit`
 * are stored on `productVersion` (null ≡ base unit).
 *
 * Example: $240 per Case (factor 24), target Sleeve (factor 6) →
 *   per-base = 240/24 = 10  →  per-sleeve = 10*6 = 60.
 *
 * Throws if either unit is missing from `conversions`.
 */
export function priceInUnit(args: {
  price: number
  fromUnit: string | null | undefined
  toUnit: string
  conversions: readonly UnitConversion[]
}): number {
  const { price, fromUnit, toUnit, conversions } = args
  const fromFactor = fromUnit == null ? 1 : getFactor(conversions, fromUnit)
  const toFactor = getFactor(conversions, toUnit)
  return (price / fromFactor) * toFactor
}

/**
 * Calculate the price for every unit in `conversions`, given a price for one
 * specific unit. Returns `null` if the calculation isn't possible (no base
 * unit, or the entered unit isn't in the conversions list).
 *
 * Prices are rounded to the nearest cent.
 */
export function allUnitPrices(
  enteredPrice: number,
  enteredUnit: string | null | undefined,
  conversions: readonly UnitConversion[],
): UnitPrice[] | null {
  if (conversions.length === 0) return null

  const baseUnit = findBaseUnit(conversions)
  if (!baseUnit) return null

  const effectiveEnteredUnit = enteredUnit ?? baseUnit.unit_name
  const enteredConv = findUnit(conversions, effectiveEnteredUnit)
  if (!enteredConv) return null

  const baseUnitPrice = enteredPrice / enteredConv.conversion_factor
  return conversions.map((conversion) => ({
    unit_name: conversion.unit_name,
    price: Math.round(baseUnitPrice * conversion.conversion_factor * 100) / 100,
    is_base_unit: conversion.is_base_unit,
    is_entered_unit: conversion.unit_name === effectiveEnteredUnit,
  }))
}

/**
 * Cost per base unit, given a price expressed in `unitName`.
 * Convenience wrapper around `priceInUnit` for callers that already know the
 * base unit name and just want the per-base-unit cost.
 */
export function getBaseUnitCost(
  unitPrice: number,
  conversions: readonly UnitConversion[],
  unitName: string | null | undefined,
): number {
  if (unitName == null) return unitPrice
  return unitPrice / getFactor(conversions, unitName)
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Render a base-unit quantity in a chosen display unit.
 * Returns the converted qty plus the unit name and a pre-formatted label.
 */
export function formatQty(
  baseQty: number,
  conversions: readonly UnitConversion[],
  displayUnit?: string | null,
): { qty: number; unit: string; label: string } {
  const target =
    (displayUnit && findUnit(conversions, displayUnit)) ?? findBaseUnit(conversions)
  if (!target) {
    return { qty: baseQty, unit: "", label: String(baseQty) }
  }
  const qty = baseQty / target.conversion_factor
  return { qty, unit: target.unit_name, label: `${qty} ${target.unit_name}` }
}
