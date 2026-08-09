import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { Product } from "../../../../db/schema/product.ts";
import { ProductVersion } from "../../../../db/schema/productVersion.ts";
import { ProductUnitConversion } from "../../../../db/schema/productUnitConversion.ts";
import { Stock } from "../../../../db/schema/stock.ts";
import * as schema from "../../../../db/schema/index.ts";

type TransactionContext = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface UnitConversionInput {
  unit_name: string;
  conversion_factor: number;
  is_base_unit: boolean;
  is_purchasable?: boolean;
}

/**
 * The only place in the codebase that writes ProductUnitConversion +
 * Product.unit. Both are the same fact stored twice (Product.unit is a
 * denormalized mirror kept only for v1 compatibility, which reads it
 * directly and can't be migrated off it since it shares this database) —
 * every mutation that touches a product's units must go through here so
 * the two can never drift out of sync with each other.
 *
 * Takes the full desired conversions list (not a diff): replaces all
 * existing ProductUnitConversion rows for the product, then derives
 * Product.unit from exactly what was just written.
 *
 * Also enforces invariants for whatever still references a unit that's
 * about to disappear or change role:
 *  - the product's EFFECTIVE cost/selling price unit can't be silently
 *    orphaned by removing it (blocks the removal instead). "Effective"
 *    means the explicit costPriceUnit/sellingPriceUnit if set, or — since
 *    a null value means "priced against whatever the base unit currently
 *    is" — the OLD base unit's name if not.
 *  - reassigning the base unit while costPriceUnit/sellingPriceUnit is
 *    null freezes it to the old base unit's name first, so the stored
 *    price number's meaning survives the reassignment instead of silently
 *    being reinterpreted against the new base (same number, different
 *    unit = different real price, with nothing to indicate it changed)
 *  - any Stock.display_unit pointing at a removed unit is cleared
 *
 * Callers that also change the active version's price units in the same
 * request (create/update) must create/repoint the version BEFORE calling
 * this, so the guard below checks the version that will actually be active
 * — not a stale one — and doesn't false-positive-block a combined edit.
 */
export async function syncProductUnits(
  tx: TransactionContext,
  params: {
    productId: string;
    tenantId: string;
    conversions: UnitConversionInput[];
  },
): Promise<void> {
  const { productId, tenantId, conversions } = params;

  // Defensive invariant: exactly one base unit if any units exist at all,
  // enforced here rather than trusted from every caller.
  const normalized =
    conversions.length > 0 && !conversions.some((c) => c.is_base_unit)
      ? conversions.map((c, i) => ({ ...c, is_base_unit: i === 0 }))
      : conversions;
  const newUnitNames = normalized.map((c) => c.unit_name);
  const newBaseUnitName = normalized.find((c) => c.is_base_unit)?.unit_name;

  // Need the OLD base unit's name — both to know what a null/implicit price
  // unit currently means, and to detect an actual base reassignment — before
  // the delete below wipes it.
  const existingConversions = await tx.query.ProductUnitConversion.findMany({
    where: and(eq(ProductUnitConversion.product_id, productId), eq(ProductUnitConversion.tenant_id, tenantId)),
    columns: { unit_name: true, is_base_unit: true },
  });
  const oldBaseUnitName = existingConversions.find((c) => c.is_base_unit)?.unit_name;

  const product = await tx.query.Product.findFirst({
    where: eq(Product.id, productId),
    columns: { activeVersionId: true },
  });
  if (product?.activeVersionId) {
    const version = await tx.query.ProductVersion.findFirst({
      where: eq(ProductVersion.id, product.activeVersionId),
      columns: { costPriceUnit: true, sellingPriceUnit: true },
    });

    // A unit still referenced by the active version's price fields can't
    // disappear out from under it — allUnitPrices() would silently return
    // null (no error) and the product's price would vanish from every list.
    // "Effective" folds in the implicit (null → old base unit) case too.
    const effectiveCostPriceUnit = version?.costPriceUnit ?? oldBaseUnitName ?? null;
    const effectiveSellingPriceUnit = version?.sellingPriceUnit ?? oldBaseUnitName ?? null;

    if (effectiveCostPriceUnit && !newUnitNames.includes(effectiveCostPriceUnit)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot remove unit "${effectiveCostPriceUnit}" — it's currently used as this product's cost price unit${version?.costPriceUnit ? "" : " (implicitly, via the base unit)"}. Change the cost price unit first.`,
      });
    }
    if (effectiveSellingPriceUnit && !newUnitNames.includes(effectiveSellingPriceUnit)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot remove unit "${effectiveSellingPriceUnit}" — it's currently used as this product's selling price unit${version?.sellingPriceUnit ? "" : " (implicitly, via the base unit)"}. Change the selling price unit first.`,
      });
    }

    // The base unit is being reassigned (not just gaining/losing unrelated
    // units) — a null price-unit field would otherwise get silently
    // reinterpreted against the new base. Freeze it to the old base's name
    // first. Guard above already guarantees the old base survives (just
    // loses base status), so this can never freeze onto a removed unit.
    // In-place update, no new ProductVersion row: the price number itself
    // isn't changing, only a previously-implicit label becomes explicit.
    if (oldBaseUnitName && newBaseUnitName && oldBaseUnitName !== newBaseUnitName) {
      const versionFreeze: { costPriceUnit?: string; sellingPriceUnit?: string } = {};
      if (!version?.costPriceUnit) versionFreeze.costPriceUnit = oldBaseUnitName;
      if (!version?.sellingPriceUnit) versionFreeze.sellingPriceUnit = oldBaseUnitName;
      if (Object.keys(versionFreeze).length > 0) {
        await tx.update(ProductVersion).set(versionFreeze).where(eq(ProductVersion.id, product.activeVersionId));
      }
    }
  }

  await tx
    .delete(ProductUnitConversion)
    .where(and(eq(ProductUnitConversion.product_id, productId), eq(ProductUnitConversion.tenant_id, tenantId)));

  if (normalized.length > 0) {
    await tx.insert(ProductUnitConversion).values(
      normalized.map((c) => ({
        product_id: productId,
        tenant_id: tenantId,
        unit_name: c.unit_name,
        conversion_factor: c.conversion_factor,
        is_base_unit: c.is_base_unit,
        is_purchasable: c.is_purchasable ?? true,
      })),
    );
  }

  await tx.update(Product).set({ unit: newUnitNames }).where(eq(Product.id, productId));

  // Stale Stock.display_unit values (referencing a unit that no longer
  // exists for this product) get cleared rather than left dangling — every
  // read site already falls back gracefully when display_unit is null.
  if (newUnitNames.length === 0) {
    await tx
      .update(Stock)
      .set({ display_unit: null })
      .where(and(eq(Stock.productId, productId), isNotNull(Stock.display_unit)));
  } else {
    await tx
      .update(Stock)
      .set({ display_unit: null })
      .where(
        and(
          eq(Stock.productId, productId),
          isNotNull(Stock.display_unit),
          notInArray(Stock.display_unit, newUnitNames),
        ),
      );
  }
}
