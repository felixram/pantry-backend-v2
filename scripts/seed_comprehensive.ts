import { db } from "../src/db/index.ts"
import {
  Category,
  Location,
  Supplier,
  Product,
  ProductVersion,
  User,
  Stock,
  PurchaseOrder,
  PurchaseOrderItem,
  StockMovement,
  PurchaseOrderAudit,
  POCounter,
} from "../src/db/schema/index.ts"
import { eq, and, isNull } from "drizzle-orm"
import { faker } from "@faker-js/faker"
import { randomUUID } from "crypto"
import { hashPassword } from "../src/utils/passwordUtils.ts"
import { ROLES, STATUS } from "../src/types/user.ts"
import { ORDER_STATUS } from "../src/types/orders.ts"

async function seedComprehensive() {
  console.log("🌱 Starting comprehensive database seeding...\n")

  try {
    // ============ 1. SEED CATEGORIES ============
    const categoryNames = [
      { name: "Electronics", description: "Electronic components and devices" },
      {
        name: "Furniture",
        description: "Office and commercial furniture",
      },
      { name: "Stationery", description: "Office supplies and stationery" },
      { name: "Hardware", description: "Tools and hardware supplies" },
      {
        name: "Cleaning Supplies",
        description: "Cleaning and maintenance products",
      },
      {
        name: "Safety Equipment",
        description: "Safety gear and protective equipment",
      },
      {
        name: "Packaging Materials",
        description: "Boxes, tape, and packaging supplies",
      },
      {
        name: "Kitchen Supplies",
        description: "Commercial kitchen equipment and supplies",
      },
      { name: "Textiles", description: "Fabrics, linens, and textile products" },
      {
        name: "Automotive Parts",
        description: "Vehicle parts and accessories",
      },
      {
        name: "Medical Supplies",
        description: "Healthcare and medical equipment",
      },
      {
        name: "Sports Equipment",
        description: "Athletic and sports gear",
      },
    ]

    const categories: Array<{ id: string; name: string }> = []
    console.log("  📦 Creating categories...")
    for (const cat of categoryNames) {
      // Check if category already exists
      let existingCategory = await db.query.Category.findFirst({
        where: eq(Category.name, cat.name),
      })

      if (existingCategory) {
        categories.push({
          id: existingCategory.id,
          name: existingCategory.name,
        })
      } else {
        const id = randomUUID()
        await db
          .insert(Category)
          .values({
            id,
            name: cat.name,
            description: cat.description,
          })
          .onConflictDoNothing()
        categories.push({ id, name: cat.name })
      }
    }
    console.log(`  ✓ Created ${categories.length} categories\n`)

    // ============ 2. SEED LOCATIONS ============
    const locations: Array<{ id: string; name: string }> = []
    console.log("  🏢 Creating locations...")

    // Check if Main Warehouse exists
    const existingMainWarehouse = await db.query.Location.findFirst({
      where: eq(Location.name, "Main Warehouse"),
    })

    if (existingMainWarehouse) {
      locations.push(existingMainWarehouse)
      console.log("  ✓ Found existing Main Warehouse")
    } else {
      const mainId = randomUUID()
      await db
        .insert(Location)
        .values({
          id: mainId,
          name: "Main Warehouse",
          address: "1000 Industrial Pkwy",
          city: "Springfield",
          state: "IL",
          postalCode: "62702",
          country: "USA",
          active: true,
        })
        .onConflictDoNothing()
      locations.push({ id: mainId, name: "Main Warehouse" })
    }

    // Additional locations
    const additionalLocations = [
      {
        name: "Distribution Center North",
        city: "Chicago",
        state: "IL",
      },
      {
        name: "Distribution Center South",
        city: "St. Louis",
        state: "MO",
      },
      { name: "Regional Hub East", city: "Indianapolis", state: "IN" },
      { name: "Regional Hub West", city: "Des Moines", state: "IA" },
      {
        name: "Express Fulfillment Center",
        city: "Milwaukee",
        state: "WI",
      },
    ]

    for (const loc of additionalLocations) {
      const id = randomUUID()
      await db
        .insert(Location)
        .values({
          id,
          name: loc.name,
          address: faker.location.streetAddress(),
          city: loc.city,
          state: loc.state,
          postalCode: faker.location.zipCode(),
          country: "USA",
          active: true,
        })
        .onConflictDoNothing()
      locations.push({ id, name: loc.name })
    }
    console.log(`  ✓ Created ${locations.length} locations\n`)

    // ============ 3. SEED SUPPLIERS ============
    const suppliers: string[] = []
    console.log("  🏭 Creating suppliers...")

    for (let i = 0; i < 14; i++) {
      const id = randomUUID()
      await db
        .insert(Supplier)
        .values({
          id,
          name: faker.company.name(),
          contact_name: faker.person.fullName(),
          email: faker.internet.email(),
          phone: faker.phone.number(),
          address: faker.location.streetAddress(),
          supplier_type: i < 7 ? "PRIMARY" : "SECONDARY",
          delivery_days: faker.helpers.arrayElement([
            "1-3",
            "3-5",
            "5-7",
            "7-10",
          ]),
          free_shipping_minimum: faker.helpers.arrayElement([
            500,
            1000,
            2000,
            null,
          ]),
          notes:
            i % 3 === 0 ? faker.commerce.productDescription() : null,
        })
        .onConflictDoNothing()
      suppliers.push(id)
    }
    console.log(`  ✓ Created ${suppliers.length} suppliers\n`)

    // ============ 4. SEED PRODUCTS ============
    const products: Array<{
      id: string
      categoryId: string
      supplierId: string
    }> = []
    console.log("  📦 Creating products...")

    const units = ["piece", "kg", "liter", "box", "pack", "meter", "set"]

    for (let i = 0; i < 90; i++) {
      const id = randomUUID()
      const category = faker.helpers.arrayElement(categories)
      const supplierId = faker.helpers.arrayElement(suppliers)

      await db
        .insert(Product)
        .values({
          id,
          sku: `SKU-${faker.string.alphanumeric(6).toUpperCase()}`,
          name: faker.commerce.productName(),
          category_id: category.id,
          supplier_id: supplierId,
          unit: [faker.helpers.arrayElement(units)],
        })
        .onConflictDoNothing()

      products.push({ id, categoryId: category.id, supplierId })
    }
    console.log(`  ✓ Created ${products.length} products\n`)

    // ============ 5. SEED PRODUCT VERSIONS ============
    console.log("  💰 Creating product versions...")
    let versionCount = 0

    for (const product of products) {
      const numVersions = faker.helpers.arrayElement([1, 2, 3])

      for (let v = 1; v <= numVersions; v++) {
        const costPrice = faker.number.float({
          min: 5,
          max: 500,
          precision: 0.01,
        })
        const markup = faker.number.float({
          min: 1.2,
          max: 2.5,
          precision: 0.1,
        })

        await db
          .insert(ProductVersion)
          .values({
            id: randomUUID(),
            productId: product.id,
            versionNumber: v,
            costPrice,
            sellingPrice: costPrice * markup,
            description:
              v > 1 ? `Price update ${v}` : "Initial pricing",
          })
          .onConflictDoNothing()

        versionCount++
      }
    }
    console.log(`  ✓ Created ${versionCount} product versions\n`)

    // ============ 6. SEED USERS ============
    const users: string[] = []
    console.log("  👥 Creating users...")

    // Admin user
    const adminId = randomUUID()
    const adminPassword = await hashPassword("admin123")
    await db
      .insert(User)
      .values({
        id: adminId,
        name: "System",
        last_name: "Administrator",
        email: "admin@ventory.com",
        password: adminPassword,
        role: ROLES.admin,
        status: STATUS.active,
        location_id: null,
      })
      .onConflictDoNothing()
    users.push(adminId)
    console.log("  ✓ Created admin user (admin@ventory.com / admin123)")

    // Regular users - generate deterministic emails so we can check for duplicates
    const baseEmails = [
      "john.doe@example.com",
      "jane.smith@example.com",
      "bob.johnson@example.com",
      "alice.williams@example.com",
      "charlie.brown@example.com",
      "diana.davis@example.com",
      "evan.miller@example.com",
      "fiona.wilson@example.com",
      "george.moore@example.com",
      "hannah.taylor@example.com",
      "ivan.anderson@example.com",
      "julia.thomas@example.com",
      "kevin.jackson@example.com",
      "lucy.martin@example.com",
    ]

    for (let i = 0; i < 14; i++) {
      const email = baseEmails[i]

      // Check if user already exists by email (excluding deleted users)
      let existingUser = await db.query.User.findFirst({
        where: and(eq(User.email, email), isNull(User.deletedAt)),
      })

      if (existingUser) {
        users.push(existingUser.id)
      } else {
        const userId = randomUUID()
        const firstName = faker.person.firstName()
        const lastName = faker.person.lastName()
        const password = await hashPassword("password123")
        const location =
          i < 12 ? faker.helpers.arrayElement(locations) : null

        await db
          .insert(User)
          .values({
            id: userId,
            name: firstName,
            last_name: lastName,
            email,
            password,
            role: ROLES.user,
            status: i < 13 ? STATUS.active : STATUS.inactive,
            location_id: location?.id || null,
          })
          .onConflictDoNothing()

        users.push(userId)
      }
    }
    console.log(
      `  ✓ Created ${users.length} users (password: password123)\n`
    )

    // ============ 7. SEED STOCK ============
    console.log("  📊 Creating stock records...")
    let stockCount = 0

    for (const product of products) {
      const numLocations = faker.helpers.arrayElement([3, 4, 5])
      const selectedLocations = faker.helpers.arrayElements(
        locations,
        numLocations
      )

      for (const location of selectedLocations) {
        const qty = faker.number.int({ min: 0, max: 500 })
        const minimumStockLevel = faker.number.int({
          min: 10,
          max: 100,
        })

        await db
          .insert(Stock)
          .values({
            id: randomUUID(),
            location_id: location.id,
            productId: product.id,
            qty,
            minimumStockLevel,
          })
          .onConflictDoNothing()

        stockCount++
      }
    }
    console.log(`  ✓ Created ${stockCount} stock records\n`)

    // ============ 8. SEED PURCHASE ORDERS ============
    const purchaseOrders: Array<{
      id: string
      poNumber: string
      status: string
      supplierId: string
    }> = []
    console.log("  📝 Creating purchase orders...")

    const currentYear = new Date().getFullYear()
    await db
      .insert(POCounter)
      .values({
        year: currentYear,
        last_sequence: 0,
      })
      .onConflictDoNothing()

    const statuses = [
      ORDER_STATUS.draft,
      ORDER_STATUS.pendingApproval,
      ORDER_STATUS.approved,
      ORDER_STATUS.ordered,
      ORDER_STATUS.received,
      ORDER_STATUS.rejected,
      ORDER_STATUS.cancelled,
    ]

    for (let i = 1; i <= 28; i++) {
      const poNumber = `PO-${currentYear}-${String(i).padStart(3, "0")}`

      // Check if PO already exists
      let existingPO = await db.query.PurchaseOrder.findFirst({
        where: eq(PurchaseOrder.po_number, poNumber),
      })

      if (existingPO) {
        purchaseOrders.push({
          id: existingPO.id,
          poNumber: existingPO.po_number,
          status: existingPO.status,
          supplierId: existingPO.supplier_id || "",
        })
      } else {
        const id = randomUUID()
        const supplierId = faker.helpers.arrayElement(suppliers)
        const location = faker.helpers.arrayElement(locations)
        const status = faker.helpers.arrayElement(statuses)

        await db
          .insert(PurchaseOrder)
          .values({
            id,
            po_number: poNumber,
            supplier_id: supplierId,
            destination_location_id: location.id,
            status,
          })
          .onConflictDoNothing()

        purchaseOrders.push({
          id,
          poNumber,
          status,
          supplierId,
        })
      }

      await db
        .update(POCounter)
        .set({ last_sequence: i })
        .where(eq(POCounter.year, currentYear))
    }
    console.log(`  ✓ Created ${purchaseOrders.length} purchase orders\n`)

    // ============ 9. SEED PURCHASE ORDER ITEMS ============
    console.log("  📋 Creating purchase order items...")
    let itemCount = 0

    for (const po of purchaseOrders) {
      const numItems = faker.number.int({ min: 4, max: 7 })
      const selectedProducts = faker.helpers.arrayElements(
        products,
        numItems
      )

      for (const product of selectedProducts) {
        const qty = faker.number.int({ min: 10, max: 200 })
        const unitPrice = faker.number.float({
          min: 10,
          max: 500,
          precision: 0.01,
        })

        await db
          .insert(PurchaseOrderItem)
          .values({
            id: randomUUID(),
            purchase_order_id: po.id,
            product_id: product.id,
            qty,
            unit_price: unitPrice,
          })
          .onConflictDoNothing()

        itemCount++
      }
    }
    console.log(`  ✓ Created ${itemCount} purchase order items\n`)

    // ============ 10. SEED STOCK MOVEMENTS ============
    console.log("  🔄 Creating stock movements...")
    let movementCount = 0

    // Fetch all valid (non-deleted) users from database to ensure IDs are valid
    const validUsers = await db.query.User.findMany({
      where: isNull(User.deletedAt),
    })
    const validUserIds = validUsers.map((u) => u.id)

    const reasons = [
      "Manual adjustment",
      "Stock count correction",
      "Damaged goods removal",
      "Transfer between locations",
      "Initial stock entry",
      "Returns processing",
    ]

    for (let i = 0; i < 80; i++) {
      const product = faker.helpers.arrayElement(products)
      const location = faker.helpers.arrayElement(locations)
      const userId = faker.helpers.arrayElement(validUserIds)
      const changeQty = faker.number.float({
        min: -50,
        max: 100,
        precision: 0.1,
      })

      await db
        .insert(StockMovement)
        .values({
          id: randomUUID(),
          product_id: product.id,
          location_id: location.id,
          change_qty: changeQty,
          reason: faker.helpers.arrayElement(reasons),
          user_id: userId,
        })
        .onConflictDoNothing()

      movementCount++
    }
    console.log(`  ✓ Created ${movementCount} stock movements\n`)

    // ============ 11. SEED PURCHASE ORDER AUDIT ============
    console.log("  📜 Creating purchase order audit entries...")
    let auditCount = 0

    const auditablePOs = purchaseOrders.filter(
      (po) =>
        po.status !== ORDER_STATUS.draft &&
        po.status !== ORDER_STATUS.received &&
        po.status !== ORDER_STATUS.rejected &&
        po.status !== ORDER_STATUS.cancelled
    )

    const regularUsers = users.slice(1)

    for (let i = 0; i < 25 && i < auditablePOs.length; i++) {
      const po = auditablePOs[i]
      const user = faker.helpers.arrayElement(regularUsers)

      await db
        .insert(PurchaseOrderAudit)
        .values({
          id: randomUUID(),
          purchaseOrderId: po.id,
          userId: user,
          fieldChanged: faker.helpers.arrayElement([
            "item_added",
            "item_updated",
            "item_removed",
            "quantity_changed",
          ]),
          oldValue: JSON.stringify({
            qty: faker.number.int({ min: 10, max: 50 }),
          }),
          newValue: JSON.stringify({
            qty: faker.number.int({ min: 51, max: 100 }),
          }),
          reason: "Updated based on revised requirements",
        })
        .onConflictDoNothing()

      auditCount++
    }
    console.log(`  ✓ Created ${auditCount} audit entries\n`)

    // ============ SUMMARY ============
    console.log("✅ Comprehensive seeding completed successfully!")
    console.log("\n📊 Summary:")
    console.log(`  - ${categories.length} Categories`)
    console.log(`  - ${locations.length} Locations`)
    console.log(`  - ${suppliers.length} Suppliers`)
    console.log(`  - ${products.length} Products`)
    console.log(`  - ${versionCount} Product Versions`)
    console.log(
      `  - ${users.length} Users (1 ADMIN, ${users.length - 1} USERS)`
    )
    console.log(`  - ${stockCount} Stock Records`)
    console.log(`  - ${purchaseOrders.length} Purchase Orders`)
    console.log(`  - ${itemCount} Purchase Order Items`)
    console.log(`  - ${movementCount} Stock Movements`)
    console.log(`  - ${auditCount} Audit Entries`)
    console.log("\n🔐 Login Credentials:")
    console.log("  Admin: admin@ventory.com / admin123")
    console.log("  Users: <generated-email> / password123")
    console.log("\n💡 Tip: Re-run this script anytime (idempotent)\n")

    process.exit(0)
  } catch (error: any) {
    console.error("\n❌ Seeding failed:", error.message)
    console.error("Details:", error)
    process.exit(1)
  }
}

seedComprehensive()
