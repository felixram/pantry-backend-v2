import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDatabase } from '../../db/index.js';
import { t } from '../../server/trpc.js';
import { appRouter } from '../../server/routers/index.js';
import { Stock } from '../../db/schema/stock.js';
import { StockMovement } from '../../db/schema/stockMovement.js';
import { eq } from 'drizzle-orm';
import { clearDatabase, createTestUser, createTestLocation, createTestProduct } from '../helpers/testDb.js';
import { ROLES } from '../../types/user.js';

const createCaller = t.createCallerFactory(appRouter);

function callerFor(user: { id: string; role: string }, tenantId: string) {
  return createCaller({
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
}

// Real Postgres required — see .github/workflows/ci.yml. The whole point of
// this suite is adjust.ts's atomic conditional UPDATE (the negative-qty
// check and the write happen in one SQL statement specifically to close a
// lost-update race) — that property is only meaningful against a real
// transactional database, not a mocked Drizzle chain.
describe('integration | stock adjustment: atomic negative-qty guard + concurrent adjustments', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('applies a positive adjustment and logs a stock movement', async () => {
    const location = await createTestLocation();
    const product = await createTestProduct();
    const admin = await createTestUser({ role: ROLES.admin });
    const [stock] = await db
      .insert(Stock)
      .values({ location_id: location!.id, productId: product!.id, tenant_id: admin!.tenant_id, qty: 10 })
      .returning();

    const caller = callerFor(admin!, admin!.tenant_id);
    const result = await caller.stock.adjust({ stock_id: stock!.id, change_qty: 5, reason: 'received extra stock' });

    expect(result.old_qty).toBe(10);
    expect(result.new_qty).toBe(15);

    const [updated] = await db.select().from(Stock).where(eq(Stock.id, stock!.id));
    expect(updated?.qty).toBe(15);

    const movements = await db.select().from(StockMovement).where(eq(StockMovement.product_id, product!.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movement_type).toBe('ADJUSTMENT');
  });

  it('rejects an adjustment that would drive qty negative, and leaves qty unchanged', async () => {
    const location = await createTestLocation();
    const product = await createTestProduct();
    const admin = await createTestUser({ role: ROLES.admin });
    const [stock] = await db
      .insert(Stock)
      .values({ location_id: location!.id, productId: product!.id, tenant_id: admin!.tenant_id, qty: 3 })
      .returning();

    const caller = callerFor(admin!, admin!.tenant_id);
    await expect(
      caller.stock.adjust({ stock_id: stock!.id, change_qty: -10, reason: 'too much shrinkage' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const [unchanged] = await db.select().from(Stock).where(eq(Stock.id, stock!.id));
    expect(unchanged?.qty).toBe(3);

    const movements = await db.select().from(StockMovement).where(eq(StockMovement.product_id, product!.id));
    expect(movements).toHaveLength(0);
  });

  it('two concurrent adjustments against the same stock row both land — no lost update', async () => {
    // This is the actual property adjust.ts's atomic conditional UPDATE
    // claims to provide: a read-then-compute-then-write sequence would let
    // both concurrent requests read qty=100 and each independently write
    // 100+30=130, silently losing one of the two +30s. Firing both through
    // real overlapping transactions is the only way to prove that isn't
    // happening here.
    const location = await createTestLocation();
    const product = await createTestProduct();
    const admin = await createTestUser({ role: ROLES.admin });
    const [stock] = await db
      .insert(Stock)
      .values({ location_id: location!.id, productId: product!.id, tenant_id: admin!.tenant_id, qty: 100 })
      .returning();

    const caller = callerFor(admin!, admin!.tenant_id);

    await Promise.all([
      caller.stock.adjust({ stock_id: stock!.id, change_qty: 30, reason: 'concurrent adjustment A' }),
      caller.stock.adjust({ stock_id: stock!.id, change_qty: 30, reason: 'concurrent adjustment B' }),
    ]);

    const [final] = await db.select().from(Stock).where(eq(Stock.id, stock!.id));
    expect(final?.qty).toBe(160); // 100 + 30 + 30, both applied

    const movements = await db.select().from(StockMovement).where(eq(StockMovement.product_id, product!.id));
    expect(movements).toHaveLength(2);
  });
});
