import { eq, and } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { ProductUnitConversion } from "../db/schema/productUnitConversion.ts"
import type { UnitConversion } from "./unitConversion.ts"

type DbLike = {
  query: {
    ProductUnitConversion: {
      findMany: (args: any) => Promise<any[]>
    }
  }
}

/**
 * Load all unit conversions for a product within a tenant.
 * Use the result with `toBaseUnits`, `priceInUnit`, etc. from `unitConversion.ts`.
 */
export async function loadUnitConversions(
  db: DbLike,
  productId: string,
  tenantId: string,
): Promise<UnitConversion[]> {
  return await db.query.ProductUnitConversion.findMany({
    where: and(
      eq(ProductUnitConversion.product_id, productId),
      eq(ProductUnitConversion.tenant_id, tenantId),
    ),
  })
}

/**
 * Resolve a unit-name input into a conversion factor.
 * `unitName` undefined/null/empty → factor 1 (i.e. "input is in base units").
 * Otherwise: look up the named unit; throw TRPCError if not found.
 *
 * Returns both the factor and the conversions array, so callers that also need
 * `toBaseUnits` / `priceInUnit` later don't refetch.
 */
export async function resolveUnitFactor(
  db: DbLike,
  productId: string,
  tenantId: string,
  unitName: string | null | undefined,
): Promise<{ conversions: UnitConversion[]; factor: number; effectiveUnit: string | null }> {
  if (!unitName) {
    const conversions = await loadUnitConversions(db, productId, tenantId)
    return { conversions, factor: 1, effectiveUnit: null }
  }
  const conversions = await loadUnitConversions(db, productId, tenantId)
  const conv = conversions.find((c) => c.unit_name === unitName)
  if (!conv) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unit "${unitName}" not found for this product`,
    })
  }
  return { conversions, factor: conv.conversion_factor, effectiveUnit: unitName }
}
