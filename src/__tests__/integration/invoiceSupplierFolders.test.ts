import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDatabase } from '../../db/index.js';
import { t } from '../../server/trpc.js';
import { appRouter } from '../../server/routers/index.js';
import { Invoice } from '../../db/schema/invoice.js';
import { ROLES } from '../../types/user.js';
import {
  clearDatabase,
  getOrCreateTestTenant,
  createTestUser,
  createTestLocation,
  createTestSupplier,
} from '../helpers/testDb.js';

const createCaller = t.createCallerFactory(appRouter);
const caller = (user: { id: string; role: string }, tenantId: string) =>
  createCaller({
    req: {} as never,
    res: {} as never,
    db,
    user: { id: user.id, role: user.role },
    userLocationId: null,
    tenantId,
    isDemoTenant: false,
    clerkUserId: null,
    clerkOrgId: null,
    isOwner: false,
  });

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('integration | invoice supplier folders', () => {
  beforeEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('groups invoices by matched supplier with counts, an unmatched bucket, and most-recent-first order', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });
    const location = await createTestLocation();
    const acme = await createTestSupplier({ name: 'Acme' });
    const globex = await createTestSupplier({ name: 'Globex' });

    // Acme: 3 invoices, newest 1 day ago. Globex: 1 invoice, 10 days ago.
    // Unmatched: 2 invoices.
    await db.insert(Invoice).values([
      { tenant_id: tenantId, location_id: location!.id, status: 'REVIEW', matched_supplier_id: acme!.id, received_at: daysAgo(1) },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: acme!.id, received_at: daysAgo(5) },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: acme!.id, received_at: daysAgo(9) },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: globex!.id, received_at: daysAgo(10) },
      { tenant_id: tenantId, location_id: location!.id, status: 'FAILED', matched_supplier_id: null, received_at: daysAgo(2) },
      { tenant_id: tenantId, location_id: location!.id, status: 'REVIEW', matched_supplier_id: null, received_at: daysAgo(3) },
    ]);

    const res = await caller(admin!, tenantId).invoice.getSupplierGroups({});

    expect(res.groups).toHaveLength(2);
    // Acme is newer (1d) than Globex (10d) → sorted first.
    expect(res.groups[0]!.supplierName).toBe('Acme');
    expect(res.groups[0]!.count).toBe(3);
    expect(res.groups[1]!.supplierName).toBe('Globex');
    expect(res.groups[1]!.count).toBe(1);
    expect(res.unmatched.count).toBe(2);
  });

  it('applies the status filter to the group counts', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });
    const location = await createTestLocation();
    const acme = await createTestSupplier({ name: 'Acme' });

    await db.insert(Invoice).values([
      { tenant_id: tenantId, location_id: location!.id, status: 'REVIEW', matched_supplier_id: acme!.id },
      { tenant_id: tenantId, location_id: location!.id, status: 'REVIEW', matched_supplier_id: acme!.id },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: acme!.id },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: null },
    ]);

    const res = await caller(admin!, tenantId).invoice.getSupplierGroups({ status: 'REVIEW' });

    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.supplierName).toBe('Acme');
    expect(res.groups[0]!.count).toBe(2);
    expect(res.unmatched.count).toBe(0);
  });

  it('getAll scopes to one supplier (with supplier_name) and to the unmatched bucket', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });
    const location = await createTestLocation();
    const acme = await createTestSupplier({ name: 'Acme' });
    const globex = await createTestSupplier({ name: 'Globex' });

    await db.insert(Invoice).values([
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: acme!.id },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: acme!.id },
      { tenant_id: tenantId, location_id: location!.id, status: 'APPLIED', matched_supplier_id: globex!.id },
      { tenant_id: tenantId, location_id: location!.id, status: 'FAILED', matched_supplier_id: null },
    ]);

    const scoped = await caller(admin!, tenantId).invoice.getAll({ supplierId: acme!.id });
    expect(scoped.results).toHaveLength(2);
    expect(scoped.results.every((r) => r.matched_supplier_id === acme!.id)).toBe(true);
    expect(scoped.results.every((r) => r.supplier_name === 'Acme')).toBe(true);

    const unmatched = await caller(admin!, tenantId).invoice.getAll({ unmatched: true });
    expect(unmatched.results).toHaveLength(1);
    expect(unmatched.results[0]!.matched_supplier_id).toBeNull();
  });
});
