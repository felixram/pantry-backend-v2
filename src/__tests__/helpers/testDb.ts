import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { User } from '../../db/schema/users.js';
import { Tenant } from '../../db/schema/tenant.js';
import { Location } from '../../db/schema/location.js';
import { Supplier } from '../../db/schema/supplier.js';
import { Product } from '../../db/schema/product.js';

// Cache for test tenant to avoid creating multiple
let testTenantId: string | null = null;

export async function clearDatabase() {
  // Reset cached tenant ID
  testTenantId = null;

  // Truncate all tables in correct order (respecting foreign keys)
  await db.execute(sql`TRUNCATE TABLE usage_event CASCADE`);
  await db.execute(sql`TRUNCATE TABLE invoice_item CASCADE`);
  await db.execute(sql`TRUNCATE TABLE invoice CASCADE`);
  await db.execute(sql`TRUNCATE TABLE stock_movement CASCADE`);
  await db.execute(sql`TRUNCATE TABLE purchase_order_item CASCADE`);
  await db.execute(sql`TRUNCATE TABLE purchase_order_audit CASCADE`);
  await db.execute(sql`TRUNCATE TABLE purchase_order CASCADE`);
  await db.execute(sql`TRUNCATE TABLE stock CASCADE`);
  await db.execute(sql`TRUNCATE TABLE product_version CASCADE`);
  await db.execute(sql`TRUNCATE TABLE product CASCADE`);
  await db.execute(sql`TRUNCATE TABLE category CASCADE`);
  await db.execute(sql`TRUNCATE TABLE supplier CASCADE`);
  await db.execute(sql`TRUNCATE TABLE location CASCADE`);
  await db.execute(sql`TRUNCATE TABLE "user" CASCADE`);
  await db.execute(sql`TRUNCATE TABLE tenant CASCADE`);
}

export async function getOrCreateTestTenant(): Promise<string> {
  if (testTenantId) {
    return testTenantId;
  }

  const [tenant] = await db
    .insert(Tenant)
    .values({
      name: 'Test Organization',
      slug: 'test-org',
      plan: 'free',
    })
    .returning();

  testTenantId = tenant!.id;
  return testTenantId;
}

export async function createTestUser(overrides: Partial<typeof User.$inferInsert> = {}) {
  // Ensure we have a test tenant
  const tenantId = overrides.tenant_id || await getOrCreateTestTenant();

  const defaults = {
    name: 'Test',
    last_name: 'User',
    email: 'test@example.com',
    role: 'USER' as const,
    status: 'ACTIVE' as const,
    tenant_id: tenantId,
  };

  const [user] = await db.insert(User).values({ ...defaults, ...overrides }).returning();
  return user;
}

export async function createTestLocation(overrides: Partial<typeof Location.$inferInsert> = {}) {
  const tenantId = overrides.tenant_id || (await getOrCreateTestTenant());
  const defaults = {
    name: 'Test Location',
    address: '123 Test St',
    tenant_id: tenantId,
  };
  const [location] = await db.insert(Location).values({ ...defaults, ...overrides }).returning();
  return location;
}

export async function createTestSupplier(overrides: Partial<typeof Supplier.$inferInsert> = {}) {
  const tenantId = overrides.tenant_id || (await getOrCreateTestTenant());
  const defaults = {
    name: 'Test Supplier',
    contact_name: 'Test Contact',
    tenant_id: tenantId,
  };
  const [supplier] = await db.insert(Supplier).values({ ...defaults, ...overrides }).returning();
  return supplier;
}

export async function createTestProduct(overrides: Partial<typeof Product.$inferInsert> = {}) {
  const tenantId = overrides.tenant_id || (await getOrCreateTestTenant());
  const defaults = {
    name: 'Test Product',
    unit: ['each'],
    tenant_id: tenantId,
  };
  const [product] = await db.insert(Product).values({ ...defaults, ...overrides }).returning();
  return product;
}
