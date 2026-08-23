/**
 * Demo Tenant Seed Script
 *
 * Creates a read-only demo account with sample data:
 * - Tenant: "Vantory Demo Corp" (is_demo: true)
 * - Admin user: demo@govantory.com / Demo123!
 * - Sample categories, locations, suppliers, products, stock
 *
 * Run with: npm run seed:demo
 */

import "dotenv/config"
import { db } from "./index.ts"
import { Tenant } from "./schema/tenant.ts"
import { User } from "./schema/users.ts"
import { Category } from "./schema/category.ts"
import { Location } from "./schema/location.ts"
import { Supplier } from "./schema/supplier.ts"
import { Product } from "./schema/product.ts"
import { ProductVersion } from "./schema/productVersion.ts"
import { Stock } from "./schema/stock.ts"
import { StockMovement } from "./schema/stockMovement.ts"
import { PurchaseOrder } from "./schema/purchaseOrder.ts"
import { PurchaseOrderItem } from "./schema/purchaseOrderItem.ts"
import { POCounter } from "./schema/poCounter.ts"
import { TenantInvoiceConfig } from "./schema/tenantInvoiceConfig.ts"
import { clerkClient } from "@clerk/express"
import { ROLES, STATUS } from "../types/user.ts"
import { ORDER_STATUS } from "../types/orders.ts"
import { eq } from "drizzle-orm"

const DEMO_TENANT_SLUG = "vantory-demo"
const DEMO_EMAIL = "demo@govantory.com"
const DEMO_PASSWORD = "VantoryDemo123!" // Clerk instance requires 15+ chars

async function seedDemo() {
  console.log("🌱 Starting demo tenant seed...")

  // Check if demo tenant already exists
  const existingTenant = await db.query.Tenant.findFirst({
    where: eq(Tenant.slug, DEMO_TENANT_SLUG),
  })

  if (existingTenant) {
    console.log("⚠️  Demo tenant already exists. Skipping sample-data seed.")
    console.log(`   Tenant ID: ${existingTenant.id}`)

    // Pre-dates the Clerk migration — link it retroactively instead of
    // leaving a demo tenant with no working login at all. Org-linking and
    // user-linking are checked independently since a prior partial run can
    // leave either one done and the other not.
    let clerkOrgId = existingTenant.clerk_org_id
    if (!clerkOrgId) {
      console.log("🔑 Tenant isn't linked to Clerk yet — creating org...")
      const clerkOrg = await clerkClient.organizations.createOrganization({
        name: existingTenant.name,
      })
      clerkOrgId = clerkOrg.id
      await db.update(Tenant).set({ clerk_org_id: clerkOrgId }).where(eq(Tenant.id, existingTenant.id))
    }

    const existingAdmin = await db.query.User.findFirst({
      where: eq(User.email, DEMO_EMAIL),
    })

    if (existingAdmin?.clerk_user_id) {
      console.log("   Demo admin user already linked to Clerk.")
    } else {
      console.log("🔑 Demo admin isn't linked to Clerk yet — creating user...")
      const clerkUser = await clerkClient.users.createUser({
        emailAddress: [DEMO_EMAIL],
        password: DEMO_PASSWORD,
        firstName: "Demo",
        lastName: "Admin",
      })
      await clerkClient.organizations.createOrganizationMembership({
        organizationId: clerkOrgId,
        userId: clerkUser.id,
        role: "org:admin",
      })

      if (existingAdmin) {
        await db.update(User).set({ clerk_user_id: clerkUser.id }).where(eq(User.id, existingAdmin.id))
      } else {
        await db.insert(User).values({
          name: "Demo",
          last_name: "Admin",
          email: DEMO_EMAIL,
          clerk_user_id: clerkUser.id,
          role: ROLES.admin,
          status: STATUS.active,
          tenant_id: existingTenant.id,
        })
      }
      console.log("   ✓ Linked to Clerk.")
    }

    console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
    process.exit(0)
  }

  // Clerk owns identity/credentials now — create the org + user there first
  // (outside the DB transaction: a script-level, one-shot operation, and if
  // the DB half fails afterward it's fine to hand-clean an orphaned demo
  // Clerk account rather than wrap an external API call in a DB transaction).
  console.log("🔑 Creating demo Clerk organization + user...")
  // Slugs are disabled on this Clerk instance (organization_settings.slug_disabled).
  const clerkOrg = await clerkClient.organizations.createOrganization({
    name: "Vantory Demo Corp",
  })
  // Re-running this script against a fresh/different database (e.g. a new
  // dev DB split off from production) can hit a Clerk user that already
  // exists from a previous run against a different DB — Clerk users are
  // unique per email per instance regardless of which DB they're linked to.
  // Fall back to the existing account instead of failing outright.
  let clerkUser
  try {
    clerkUser = await clerkClient.users.createUser({
      emailAddress: [DEMO_EMAIL],
      password: DEMO_PASSWORD,
      firstName: "Demo",
      lastName: "Admin",
    })
  } catch (err) {
    const isExisting =
      err && typeof err === "object" && "errors" in err &&
      Array.isArray((err as { errors: unknown[] }).errors) &&
      (err as { errors: { code?: string }[] }).errors.some((e) => e.code === "form_identifier_exists")
    if (!isExisting) throw err

    console.log(`  · Clerk user for ${DEMO_EMAIL} already exists (from a prior run) — reusing it.`)
    const { data: existing } = await clerkClient.users.getUserList({ emailAddress: [DEMO_EMAIL] })
    const found = existing[0]
    if (!found) throw new Error(`Clerk reported ${DEMO_EMAIL} as taken but getUserList found no match`)
    clerkUser = found
  }
  await clerkClient.organizations.createOrganizationMembership({
    organizationId: clerkOrg.id,
    userId: clerkUser.id,
    role: "org:admin",
  })

  await db.transaction(async (tx) => {
    // 1. Create Demo Tenant
    console.log("📦 Creating demo tenant...")
    const [tenant] = await tx
      .insert(Tenant)
      .values({
        name: "Vantory Demo Corp",
        slug: DEMO_TENANT_SLUG,
        plan: "PRO",
        is_demo: true,
        clerk_org_id: clerkOrg.id,
      })
      .returning()

    const tenantId = tenant!.id

    // 2. Create Demo Admin User
    console.log("👤 Creating demo admin user...")
    const [adminUser] = await tx
      .insert(User)
      .values({
        name: "Demo",
        last_name: "Admin",
        email: DEMO_EMAIL,
        clerk_user_id: clerkUser.id,
        role: ROLES.admin,
        status: STATUS.active,
        tenant_id: tenantId,
      })
      .returning()

    // 2b. Create Invoice Config
    await tx.insert(TenantInvoiceConfig).values({
      tenant_id: tenantId,
      inbound_email_address: `${DEMO_TENANT_SLUG}@invoices.govantory.com`,
    })

    // 3. Create Categories
    console.log("📂 Creating categories...")
    const categoriesData = [
      { name: "Electronics", description: "Electronic devices and accessories" },
      { name: "Office Supplies", description: "General office supplies and stationery" },
      { name: "Furniture", description: "Office and warehouse furniture" },
      { name: "Packaging", description: "Boxes, tape, and packaging materials" },
      { name: "Safety Equipment", description: "PPE and safety gear" },
    ]

    const categories = await tx
      .insert(Category)
      .values(categoriesData.map((c) => ({ ...c, tenant_id: tenantId })))
      .returning()

    const categoryMap = Object.fromEntries(
      categories.map((c) => [c.name, c.id])
    )

    // 4. Create Locations
    console.log("📍 Creating locations...")
    const locationsData = [
      {
        name: "Main Warehouse",
        address: "123 Industrial Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "USA",
      },
      {
        name: "Downtown Store",
        address: "456 Congress Ave",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        country: "USA",
      },
      {
        name: "North Distribution Center",
        address: "789 Commerce Dr",
        city: "Round Rock",
        state: "TX",
        postalCode: "78664",
        country: "USA",
      },
    ]

    const locations = await tx
      .insert(Location)
      .values(locationsData.map((l) => ({ ...l, tenant_id: tenantId })))
      .returning()

    const locationMap = Object.fromEntries(
      locations.map((l) => [l.name, l.id])
    )

    // 5. Create Suppliers
    console.log("🚚 Creating suppliers...")
    const suppliersData = [
      {
        name: "TechWorld Distributors",
        contact_name: "John Smith",
        phone: "512-555-0101",
        email: "orders@techworld.example",
        address: "100 Tech Park, San Jose, CA",
        delivery_days: "3-5 business days",
        supplier_type: "PRIMARY",
      },
      {
        name: "Office Essentials Inc",
        contact_name: "Sarah Johnson",
        phone: "512-555-0102",
        email: "sales@officeessentials.example",
        address: "200 Supply Lane, Dallas, TX",
        delivery_days: "2-3 business days",
        supplier_type: "PRIMARY",
      },
      {
        name: "Global Furniture Co",
        contact_name: "Mike Chen",
        phone: "512-555-0103",
        email: "mike@globalfurniture.example",
        address: "300 Furniture Ave, Houston, TX",
        delivery_days: "7-10 business days",
        supplier_type: "SECONDARY",
      },
      {
        name: "SafetyFirst Supply",
        contact_name: "Lisa Brown",
        phone: "512-555-0104",
        email: "orders@safetyfirst.example",
        address: "400 Safety St, Austin, TX",
        delivery_days: "1-2 business days",
        supplier_type: "PRIMARY",
      },
    ]

    const suppliers = await tx
      .insert(Supplier)
      .values(suppliersData.map((s) => ({ ...s, tenant_id: tenantId })))
      .returning()

    const supplierMap = Object.fromEntries(
      suppliers.map((s) => [s.name, s.id])
    )

    // 6. Create Products with Versions
    console.log("📦 Creating products...")
    const productsData = [
      // Electronics
      { sku: "ELEC-001", name: "Wireless Mouse", category: "Electronics", supplier: "TechWorld Distributors", unit: ["pcs", "box"], costPrice: 15.99, sellingPrice: 29.99, description: "Ergonomic wireless mouse" },
      { sku: "ELEC-002", name: "USB-C Hub", category: "Electronics", supplier: "TechWorld Distributors", unit: ["pcs"], costPrice: 35.00, sellingPrice: 59.99, description: "7-port USB-C hub" },
      { sku: "ELEC-003", name: "Webcam HD 1080p", category: "Electronics", supplier: "TechWorld Distributors", unit: ["pcs"], costPrice: 45.00, sellingPrice: 79.99, description: "HD webcam for video calls" },
      { sku: "ELEC-004", name: "Mechanical Keyboard", category: "Electronics", supplier: "TechWorld Distributors", unit: ["pcs"], costPrice: 55.00, sellingPrice: 99.99, description: "RGB mechanical keyboard" },

      // Office Supplies
      { sku: "OFFC-001", name: "A4 Paper Ream", category: "Office Supplies", supplier: "Office Essentials Inc", unit: ["ream", "case"], costPrice: 4.99, sellingPrice: 8.99, description: "500 sheets, 80gsm" },
      { sku: "OFFC-002", name: "Ballpoint Pens (12pk)", category: "Office Supplies", supplier: "Office Essentials Inc", unit: ["pack", "case"], costPrice: 3.50, sellingPrice: 6.99, description: "Blue ink, medium point" },
      { sku: "OFFC-003", name: "Sticky Notes 3x3", category: "Office Supplies", supplier: "Office Essentials Inc", unit: ["pack"], costPrice: 2.00, sellingPrice: 4.49, description: "Yellow, 100 sheets per pad" },
      { sku: "OFFC-004", name: "Stapler Heavy Duty", category: "Office Supplies", supplier: "Office Essentials Inc", unit: ["pcs"], costPrice: 12.00, sellingPrice: 19.99, description: "50 sheet capacity" },

      // Furniture
      { sku: "FURN-001", name: "Office Chair Ergonomic", category: "Furniture", supplier: "Global Furniture Co", unit: ["pcs"], costPrice: 180.00, sellingPrice: 299.99, description: "Adjustable lumbar support" },
      { sku: "FURN-002", name: "Standing Desk 60\"", category: "Furniture", supplier: "Global Furniture Co", unit: ["pcs"], costPrice: 350.00, sellingPrice: 549.99, description: "Electric height adjustable" },
      { sku: "FURN-003", name: "Filing Cabinet 3-Drawer", category: "Furniture", supplier: "Global Furniture Co", unit: ["pcs"], costPrice: 120.00, sellingPrice: 199.99, description: "Metal, lockable" },

      // Packaging
      { sku: "PACK-001", name: "Cardboard Box Medium", category: "Packaging", supplier: "Office Essentials Inc", unit: ["pcs", "bundle"], costPrice: 1.50, sellingPrice: 2.99, description: "12x12x12 inches" },
      { sku: "PACK-002", name: "Bubble Wrap Roll", category: "Packaging", supplier: "Office Essentials Inc", unit: ["roll"], costPrice: 25.00, sellingPrice: 39.99, description: "100ft x 12in" },
      { sku: "PACK-003", name: "Packing Tape", category: "Packaging", supplier: "Office Essentials Inc", unit: ["roll", "case"], costPrice: 2.50, sellingPrice: 4.99, description: "2\" x 110 yards" },

      // Safety
      { sku: "SAFE-001", name: "Safety Goggles", category: "Safety Equipment", supplier: "SafetyFirst Supply", unit: ["pcs", "box"], costPrice: 5.00, sellingPrice: 9.99, description: "ANSI Z87.1 certified" },
      { sku: "SAFE-002", name: "Work Gloves Heavy", category: "Safety Equipment", supplier: "SafetyFirst Supply", unit: ["pair", "box"], costPrice: 8.00, sellingPrice: 14.99, description: "Cut-resistant, size L" },
      { sku: "SAFE-003", name: "First Aid Kit", category: "Safety Equipment", supplier: "SafetyFirst Supply", unit: ["kit"], costPrice: 35.00, sellingPrice: 59.99, description: "100-piece kit" },
    ]

    const products: Array<{ id: string; name: string }> = []
    for (const p of productsData) {
      const [product] = await tx
        .insert(Product)
        .values({
          sku: p.sku,
          name: p.name,
          category_id: categoryMap[p.category],
          supplier_id: supplierMap[p.supplier],
          tenant_id: tenantId,
          unit: p.unit,
          defaultUnit: p.unit[0],
        })
        .returning()

      const [version] = await tx
        .insert(ProductVersion)
        .values({
          productId: product!.id,
          versionNumber: 1,
          costPrice: p.costPrice,
          sellingPrice: p.sellingPrice,
          description: p.description,
        })
        .returning()

      await tx
        .update(Product)
        .set({ activeVersionId: version!.id })
        .where(eq(Product.id, product!.id))

      products.push({ id: product!.id, name: p.name })
    }

    const productMap = Object.fromEntries(products.map((p) => [p.name, p.id]))

    // 7. Create Stock Records
    console.log("📊 Creating stock records...")
    const stockData = [
      // Main Warehouse - well stocked
      { product: "Wireless Mouse", location: "Main Warehouse", qty: 150, minLevel: 50 },
      { product: "USB-C Hub", location: "Main Warehouse", qty: 75, minLevel: 20 },
      { product: "Webcam HD 1080p", location: "Main Warehouse", qty: 40, minLevel: 15 },
      { product: "Mechanical Keyboard", location: "Main Warehouse", qty: 60, minLevel: 20 },
      { product: "A4 Paper Ream", location: "Main Warehouse", qty: 500, minLevel: 100 },
      { product: "Ballpoint Pens (12pk)", location: "Main Warehouse", qty: 200, minLevel: 50 },
      { product: "Office Chair Ergonomic", location: "Main Warehouse", qty: 25, minLevel: 10 },
      { product: "Standing Desk 60\"", location: "Main Warehouse", qty: 12, minLevel: 5 },
      { product: "Cardboard Box Medium", location: "Main Warehouse", qty: 300, minLevel: 100 },
      { product: "Safety Goggles", location: "Main Warehouse", qty: 100, minLevel: 30 },
      { product: "Work Gloves Heavy", location: "Main Warehouse", qty: 80, minLevel: 25 },
      { product: "First Aid Kit", location: "Main Warehouse", qty: 15, minLevel: 5 },

      // Downtown Store - some low stock items
      { product: "Wireless Mouse", location: "Downtown Store", qty: 25, minLevel: 10 },
      { product: "USB-C Hub", location: "Downtown Store", qty: 8, minLevel: 10 },  // Low stock
      { product: "A4 Paper Ream", location: "Downtown Store", qty: 50, minLevel: 25 },
      { product: "Sticky Notes 3x3", location: "Downtown Store", qty: 5, minLevel: 15 },  // Low stock
      { product: "Stapler Heavy Duty", location: "Downtown Store", qty: 12, minLevel: 5 },

      // North Distribution Center
      { product: "Cardboard Box Medium", location: "North Distribution Center", qty: 500, minLevel: 150 },
      { product: "Bubble Wrap Roll", location: "North Distribution Center", qty: 30, minLevel: 10 },
      { product: "Packing Tape", location: "North Distribution Center", qty: 100, minLevel: 40 },
      { product: "Filing Cabinet 3-Drawer", location: "North Distribution Center", qty: 8, minLevel: 3 },
    ]

    for (const s of stockData) {
      const [stock] = await tx
        .insert(Stock)
        .values({
          productId: productMap[s.product],
          location_id: locationMap[s.location],
          qty: s.qty,
          minimumStockLevel: s.minLevel,
          tenant_id: tenantId,
        })
        .returning()

      // Log initial stock movement
      await tx.insert(StockMovement).values({
        product_id: productMap[s.product],
        location_id: locationMap[s.location],
        change_qty: s.qty,
        reason: "Initial inventory setup",
        user_id: adminUser!.id,
        tenant_id: tenantId,
      })
    }

    // 8. Create PO Counter
    console.log("🔢 Creating PO counter...")
    const currentYear = new Date().getFullYear()
    await tx.insert(POCounter).values({
      tenant_id: tenantId,
      year: currentYear,
      last_sequence: 1005,
    })

    // 9. Create Sample Purchase Orders
    console.log("📋 Creating sample purchase orders...")

    // PO 1: Draft
    const [po1] = await tx
      .insert(PurchaseOrder)
      .values({
        po_number: "PO-1001",
        supplier_id: supplierMap["TechWorld Distributors"],
        destination_location_id: locationMap["Main Warehouse"],
        status: ORDER_STATUS.draft,
        tenant_id: tenantId,
      })
      .returning()

    await tx.insert(PurchaseOrderItem).values([
      { purchase_order_id: po1!.id, product_id: productMap["Wireless Mouse"]!, qty: 50, unit_price: 15.99 },
      { purchase_order_id: po1!.id, product_id: productMap["USB-C Hub"]!, qty: 25, unit_price: 35.00 },
    ])

    // PO 2: Pending Approval
    const [po2] = await tx
      .insert(PurchaseOrder)
      .values({
        po_number: "PO-1002",
        supplier_id: supplierMap["Office Essentials Inc"],
        destination_location_id: locationMap["Downtown Store"],
        status: ORDER_STATUS.pendingApproval,
        tenant_id: tenantId,
      })
      .returning()

    await tx.insert(PurchaseOrderItem).values([
      { purchase_order_id: po2!.id, product_id: productMap["A4 Paper Ream"]!, qty: 100, unit_price: 4.99 },
      { purchase_order_id: po2!.id, product_id: productMap["Sticky Notes 3x3"]!, qty: 50, unit_price: 2.00 },
    ])

    // PO 3: Approved
    const [po3] = await tx
      .insert(PurchaseOrder)
      .values({
        po_number: "PO-1003",
        supplier_id: supplierMap["Global Furniture Co"],
        destination_location_id: locationMap["Main Warehouse"],
        status: ORDER_STATUS.approved,
        tenant_id: tenantId,
      })
      .returning()

    await tx.insert(PurchaseOrderItem).values([
      { purchase_order_id: po3!.id, product_id: productMap["Office Chair Ergonomic"]!, qty: 10, unit_price: 180.00 },
      { purchase_order_id: po3!.id, product_id: productMap["Standing Desk 60\""]!, qty: 5, unit_price: 350.00 },
    ])

    // PO 4: Ordered (sent to supplier)
    const [po4] = await tx
      .insert(PurchaseOrder)
      .values({
        po_number: "PO-1004",
        supplier_id: supplierMap["SafetyFirst Supply"],
        destination_location_id: locationMap["Main Warehouse"],
        status: ORDER_STATUS.ordered,
        tenant_id: tenantId,
      })
      .returning()

    await tx.insert(PurchaseOrderItem).values([
      { purchase_order_id: po4!.id, product_id: productMap["Safety Goggles"]!, qty: 50, unit_price: 5.00 },
      { purchase_order_id: po4!.id, product_id: productMap["Work Gloves Heavy"]!, qty: 40, unit_price: 8.00 },
      { purchase_order_id: po4!.id, product_id: productMap["First Aid Kit"]!, qty: 10, unit_price: 35.00 },
    ])

    // PO 5: Received (completed)
    const [po5] = await tx
      .insert(PurchaseOrder)
      .values({
        po_number: "PO-1005",
        supplier_id: supplierMap["Office Essentials Inc"],
        destination_location_id: locationMap["North Distribution Center"],
        status: ORDER_STATUS.received,
        tenant_id: tenantId,
      })
      .returning()

    await tx.insert(PurchaseOrderItem).values([
      { purchase_order_id: po5!.id, product_id: productMap["Cardboard Box Medium"]!, qty: 200, unit_price: 1.50 },
      { purchase_order_id: po5!.id, product_id: productMap["Packing Tape"]!, qty: 50, unit_price: 2.50 },
    ])

    console.log("")
    console.log("✅ Demo tenant created successfully!")
    console.log("")
    console.log("📋 Summary:")
    console.log(`   Tenant ID: ${tenantId}`)
    console.log(`   Tenant Name: Vantory Demo Corp`)
    console.log(`   Categories: ${categories.length}`)
    console.log(`   Locations: ${locations.length}`)
    console.log(`   Suppliers: ${suppliers.length}`)
    console.log(`   Products: ${products.length}`)
    console.log(`   Stock Records: ${stockData.length}`)
    console.log(`   Purchase Orders: 5`)
    console.log("")
    console.log("🔐 Login credentials:")
    console.log(`   Email: ${DEMO_EMAIL}`)
    console.log(`   Password: ${DEMO_PASSWORD}`)
    console.log("")
    console.log("⚠️  This is a READ-ONLY demo account. All mutations are blocked.")
  })

  process.exit(0)
}

seedDemo().catch((err) => {
  console.error("❌ Error seeding demo tenant:", err)
  process.exit(1)
})
