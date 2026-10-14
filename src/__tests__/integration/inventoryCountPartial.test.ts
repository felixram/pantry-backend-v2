import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDatabase } from '../../db/index.js';
import { t } from '../../server/trpc.js';
import { appRouter } from '../../server/routers/index.js';
import { InventoryCountSession } from '../../db/schema/inventoryCountSession.js';
import { InventoryCountEntry } from '../../db/schema/inventoryCountEntry.js';
import { Stock } from '../../db/schema/stock.js';
import { eq } from 'drizzle-orm';
import { ROLES } from '../../types/user.js';
import {
  clearDatabase,
  getOrCreateTestTenant,
  createTestUser,
  createTestLocation,
  createTestProduct,
} from '../helpers/testDb.js';

const createCaller = t.createCallerFactory(appRouter);
const caller = (user: { id: string; role: string }, tenantId: string, userLocationId: string | null = null) =>
  createCaller({
    req: {} as never,
    res: {} as never,
    db,
    user: { id: user.id, role: user.role },
    userLocationId,
    tenantId,
    isDemoTenant: false,
    clerkUserId: null,
    clerkOrgId: null,
    isOwner: false,
  });

/** Seeds a tenant/location/product/stock + one ACTIVE session with one entry. */
async function seedActiveSession() {
  const tenantId = await getOrCreateTestTenant();
  const location = await createTestLocation();
  const product = await createTestProduct();
  const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });

  const [stock] = await db
    .insert(Stock)
    .values({ location_id: location!.id, productId: product!.id, tenant_id: tenantId, qty: 10 })
    .returning();

  const [session] = await db
    .insert(InventoryCountSession)
    .values({
      tenant_id: tenantId,
      location_id: location!.id,
      created_by: admin!.id,
      week_identifier: '2026-W42',
      status: 'ACTIVE',
    })
    .returning();

  const [entry] = await db
    .insert(InventoryCountEntry)
    .values({
      session_id: session!.id,
      stock_id: stock!.id,
      product_id: product!.id,
      expected_qty: 10,
    })
    .returning();

  return { tenantId, location, product, admin, stock, session: session!, entry: entry! };
}

describe('integration | inventory count — "not done yet" partial flag', () => {
  beforeEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('bulkUpdateEntries persists is_partial alongside the counted qty', async () => {
    const { tenantId, admin, session, entry } = await seedActiveSession();

    await caller(admin!, tenantId).inventoryCount.bulkUpdateEntries({
      session_id: session.id,
      updates: [{ entry_id: entry.id, counted_qty: 5, is_partial: true }],
    });

    const [updated] = await db.select().from(InventoryCountEntry).where(eq(InventoryCountEntry.id, entry.id));
    expect(updated!.counted_qty).toBe(5);
    expect(updated!.is_partial).toBe(true);
  });

  it('completeSession rejects while any entry is marked partial, and succeeds once cleared', async () => {
    const { tenantId, admin, session, entry } = await seedActiveSession();

    await caller(admin!, tenantId).inventoryCount.bulkUpdateEntries({
      session_id: session.id,
      updates: [{ entry_id: entry.id, counted_qty: 5, is_partial: true }],
    });

    await expect(
      caller(admin!, tenantId).inventoryCount.completeSession({ session_id: session.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Session must still be ACTIVE — the rejected attempt didn't half-apply.
    const [stillActive] = await db.select().from(InventoryCountSession).where(eq(InventoryCountSession.id, session.id));
    expect(stillActive!.status).toBe('ACTIVE');

    // Counter comes back and marks it done — same qty, is_partial now false.
    await caller(admin!, tenantId).inventoryCount.bulkUpdateEntries({
      session_id: session.id,
      updates: [{ entry_id: entry.id, counted_qty: 5, is_partial: false }],
    });

    const result = await caller(admin!, tenantId).inventoryCount.completeSession({ session_id: session.id });
    expect(result.status).toBe('COMPLETED');
    expect(result.adjustedItems).toBe(1); // 10 expected -> 5 counted, a real variance
  });

  it('an entry never touched at all still completes fine — not the same as partial', async () => {
    const { tenantId, admin, session } = await seedActiveSession();
    const result = await caller(admin!, tenantId).inventoryCount.completeSession({ session_id: session.id });
    expect(result.status).toBe('COMPLETED');
    expect(result.skippedItems).toBe(1);
  });

  it('a plain counted_qty update (no is_partial field) leaves is_partial untouched', async () => {
    const { tenantId, admin, session, entry } = await seedActiveSession();

    await caller(admin!, tenantId).inventoryCount.bulkUpdateEntries({
      session_id: session.id,
      updates: [{ entry_id: entry.id, counted_qty: 5, is_partial: true }],
    });
    // A plain tap (e.g. +1) omits is_partial entirely — must not reset it.
    await caller(admin!, tenantId).inventoryCount.bulkUpdateEntries({
      session_id: session.id,
      updates: [{ entry_id: entry.id, counted_qty: 6 }],
    });

    const [updated] = await db.select().from(InventoryCountEntry).where(eq(InventoryCountEntry.id, entry.id));
    expect(updated!.counted_qty).toBe(6);
    expect(updated!.is_partial).toBe(true);
  });
});
