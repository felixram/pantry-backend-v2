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
 * Also enforces two invariants for whatever still references a unit that's
 * about to disappear:
 *  - the product's active ProductVersion's costPriceUnit/sellingPriceUnit
 *    can't be silently orphaned (blocks the removal instead)
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

  // A unit still referenced by the active version's price fields can't
  // disappear out from under it — allUnitPrices() would silently return
  // null (no error) and the product's price would vanish from every list.
  const product = await tx.query.Product.findFirst({
    where: eq(Product.id, productId),
    columns: { activeVersionId: true },
  });
  if (product?.activeVersionId) {
    const version = await tx.query.ProductVersion.findFirst({
      where: eq(ProductVersion.id, product.activeVersionId),
      columns: { costPriceUnit: true, sellingPriceUnit: true },
    });
    if (version?.costPriceUnit && !newUnitNames.includes(version.costPriceUnit)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot remove unit "${version.costPriceUnit}" — it's currently set as this product's cost price unit. Change the cost price unit first.`,
      });
    }
    if (version?.sellingPriceUnit && !newUnitNames.includes(version.sellingPriceUnit)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot remove unit "${version.sellingPriceUnit}" — it's currently set as this product's selling price unit. Change the selling price unit first.`,
      });
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
