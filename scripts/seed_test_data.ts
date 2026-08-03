import { db } from "../src/db/index.ts"
import { Category } from "../src/db/schema/category.ts"
import { Location } from "../src/db/schema/location.ts"
import { Supplier } from "../src/db/schema/supplier.ts"
import { Product } from "../src/db/schema/product.ts"
import { Stock } from "../src/db/schema/stock.ts"
import { randomUUID } from "crypto"

async function seedTestData() {
  try {
    console.log("🌱 Seeding test data...")

    // Create locations
    const location1Id = randomUUID()
    console.log("  Creating location 1...")
    await db.insert(Location).values({
      id: location1Id,
      name: "Warehouse A",
      address: "123 Main St",
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
      country: "USA",
    }).onConflictDoNothing()

    const location2Id = randomUUID()
    console.log("  Creating location 2...")
    await db.insert(Location).values({
      id: location2Id,
      name: "Warehouse B",
      address: "456 Oak Ave",
      city: "Chicago",
      state: "IL",
      postalCode: "60601",
      country: "USA",
    }).onConflictDoNothing()

    // Create suppliers
    const supplierId = randomUUID()
    console.log("  Creating supplier...")
    await db.insert(Supplier).values({
      id: supplierId,
      name: "Tech Supplies Co",
      contact_name: "John Smith",
      email: "info@techsupplies.com",
      phone: "555-0100",
      address: "789 Industrial Blvd",
    }).onConflictDoNothing()

    // Create categories
    const categoryId = randomUUID()
    console.log("  Creating category...")
    await db.insert(Category).values({
      id: categoryId,
      name: "Electronics",
      description: "Electronic components and devices",
    }).onConflictDoNothing()

    // Create products
    const productId = randomUUID()
    console.log("  Creating product...")
    await db.insert(Product).values({
      id: productId,
      sku: "ELEC-001",
      name: "Resistor 10K",
      category_id: categoryId,
      supplier_id: supplierId,
      unit: "piece",
    }).onConflictDoNothing()

    // Create stock records
    const stock1Id = randomUUID()
    const stock2Id = randomUUID()
    console.log("  Creating stock record 1...")
    await db.insert(Stock).values({
      id: stock1Id,
      location_id: location1Id,
      productId: productId,
      qty: 100,
      minimumStockLevel: 50,
    }).onConflictDoNothing()

    console.log("  Creating stock record 2...")
    await db.insert(Stock).values({
      id: stock2Id,
      location_id: location2Id,
      productId: productId,
      qty: 25,
      minimumStockLevel: 50,
    }).onConflictDoNothing()

    console.log("✅ Test data seeded successfully!")
    console.log("")
    console.log("Created:")
    console.log(`  - 2 Locations`)
    console.log(`  - 1 Supplier`)
    console.log(`  - 1 Category`)
    console.log(`  - 1 Product with 2 stock locations`)
    console.log("")
    console.log("IDs for testing:")
    console.log(`  - Category ID: ${categoryId}`)
    console.log(`  - Product ID: ${productId}`)
    console.log(`  - Location 1 ID: ${location1Id}`)
    console.log(`  - Location 2 ID: ${location2Id}`)
    console.log(`  - Stock 1 ID: ${stock1Id}`)
    console.log(`  - Stock 2 ID: ${stock2Id}`)

    process.exit(0)
  } catch (error: any) {
    console.error("❌ Error:", error.message)
    console.error("Details:", error)
    process.exit(1)
  }
}

seedTestData()
