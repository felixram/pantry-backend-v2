/**
 * One-time data migration script
 *
 * Converts existing product `unit` arrays into `ProductUnitConversion` entries.
 * For each product with a non-empty unit array:
 *  - Determines base unit: defaultUnit if set, otherwise first element of unit[]
 *  - Creates conversion entries with factor=1 for all units
 *  - Marks the base unit with is_base_unit=true
 *  - Skips products that already have conversion entries (idempotent)
 *
 * Usage: npx tsx src/db/migrateUnitsToConversions.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, isNull } from "drizzle-orm";
import { Product } from "./schema/product.ts";
import { ProductUnitConversion } from "./schema/productUnitConversion.ts";
import * as schema from "./schema/index.ts";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

async function migrate() {
  console.log("Starting unit conversion migration...");

  // Fetch all non-deleted products
  const products = await db.query.Product.findMany({
    where: isNull(Product.deletedAt),
  });

  console.log(`Found ${products.length} products to process`);

  let created = 0;
  let skipped = 0;

  for (const product of products) {
    // Skip products with no units defined
    if (!product.unit || product.unit.length === 0) {
      skipped++;
      continue;
    }

    // Check if conversions already exist for this product
    const existingConversions =
      await db.query.ProductUnitConversion.findMany({
        where: eq(ProductUnitConversion.product_id, product.id),
      });

    if (existingConversions.length > 0) {
      skipped++;
      continue;
    }

    // Determine base unit: defaultUnit if set and exists in array, otherwise first unit
    const baseUnitName =
      product.defaultUnit && product.unit.includes(product.defaultUnit)
        ? product.defaultUnit
        : product.unit[0]!;

    // Create conversion entries
    const values = product.unit.map((unitName) => ({
      product_id: product.id,
      tenant_id: product.tenant_id,
      unit_name: unitName,
      conversion_factor: 1,
      is_base_unit: unitName === baseUnitName,
    }));

    await db.insert(ProductUnitConversion).values(values);

    created += product.unit.length;
    console.log(
      `  Product "${product.name}" (${product.id}): created ${product.unit.length} conversion entries, base unit: "${baseUnitName}"`
    );
  }

  console.log(
    `\nMigration complete: ${created} conversion entries created, ${skipped} products skipped`
  );

  await client.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
