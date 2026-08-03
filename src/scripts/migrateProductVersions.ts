/**
 * Migration script to create ProductVersion records for products that don't have one.
 * This fixes the issue where legacy products don't have activeVersionId set,
 * causing the Cost column to show "-" in the ProductSelectionTable.
 *
 * Run with: npx tsx src/scripts/migrateProductVersions.ts
 */

import { db } from "../db/index.ts"
import { Product } from "../db/schema/product.ts"
import { ProductVersion } from "../db/schema/productVersion.ts"
import { isNull, eq } from "drizzle-orm"

async function migrateProductVersions() {
  console.log("Starting product version migration...")

  // Find all products without an activeVersionId
  const productsWithoutVersion = await db.query.Product.findMany({
    where: isNull(Product.activeVersionId),
  })

  console.log(
    `Found ${productsWithoutVersion.length} products without activeVersionId`
  )

  if (productsWithoutVersion.length === 0) {
    console.log("No products need migration. Exiting.")
    return
  }

  let successCount = 0
  let errorCount = 0

  for (const product of productsWithoutVersion) {
    try {
      await db.transaction(async (tx) => {
        // Create a new ProductVersion with default values
        const [newVersion] = await tx
          .insert(ProductVersion)
          .values({
            productId: product.id,
            versionNumber: 1,
            costPrice: 0, // Default cost price
            sellingPrice: null,
            description: null,
          })
          .returning({ id: ProductVersion.id })

        if (!newVersion) {
          throw new Error(`Failed to create version for product ${product.id}`)
        }

        // Update the product with the new activeVersionId
        await tx
          .update(Product)
          .set({ activeVersionId: newVersion.id })
          .where(eq(Product.id, product.id))

        console.log(
          `✓ Created version for product: ${product.name} (${product.id})`
        )
        successCount++
      })
    } catch (error) {
      console.error(
        `✗ Failed to migrate product: ${product.name} (${product.id})`,
        error
      )
      errorCount++
    }
  }

  console.log("\n=== Migration Complete ===")
  console.log(`Successfully migrated: ${successCount} products`)
  console.log(`Failed: ${errorCount} products`)
}

// Run the migration
migrateProductVersions()
  .then(() => {
    console.log("\nMigration script finished.")
    process.exit(0)
  })
  .catch((error) => {
    console.error("Migration script failed:", error)
    process.exit(1)
  })
