import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { Product } from "../../../../db/schema/product.ts";
import { ProductUnitConversion } from "../../../../db/schema/productUnitConversion.ts";
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

  await tx
    .update(Product)
    .set({ unit: normalized.map((c) => c.unit_name) })
    .where(eq(Product.id, productId));
}
