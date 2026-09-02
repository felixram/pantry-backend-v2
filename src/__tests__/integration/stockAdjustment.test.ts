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

  async function seedStock(qty: number) {
    const location = await createTestLocation();
    const product = await createTestProduct();
    const admin = await createTestUser({ role: ROLES.admin });
    const [stock] = await db
      .insert(Stock)
      .values({ location_id: location!.id, productId: product!.id, tenant_id: admin!.tenant_id, qty })
      .returning();
    return { location, product, admin, stock, caller: callerFor(admin!, admin!.tenant_id) };
  }

  it('set mode writes the absolute qty and logs the computed delta as COUNT_ADJUSTMENT', async () => {
    const { product, stock, caller } = await seedStock(15);

    const result = await caller.stock.adjust({
      stock_id: stock!.id,
      mode: 'set',
      target_qty: 12,
      reason_code: 'PHYSICAL_COUNT',
    });

    expect(result).toMatchObject({ mode: 'set', reason_code: 'PHYSICAL_COUNT', old_qty: 15, new_qty: 12, change: -3 });

    const [updated] = await db.select().from(Stock).where(eq(Stock.id, stock!.id));
    expect(updated?.qty).toBe(12);

    const [movement] = await db.select().from(StockMovement).where(eq(StockMovement.product_id, product!.id));
    expect(movement!.change_qty).toBe(-3);
    expect(movement!.movement_type).toBe('COUNT_ADJUSTMENT');
    expect(movement!.reason_code).toBe('PHYSICAL_COUNT');
  });

  it('set mode can zero out stock', async () => {
    const { stock, caller } = await seedStock(7);
    const result = await caller.stock.adjust({
      stock_id: stock!.id,
      mode: 'set',
      target_qty: 0,
      reason_code: 'DAMAGED',
    });
    expect(result).toMatchObject({ old_qty: 7, new_qty: 0, change: -7 });
    const [updated] = await db.select().from(Stock).where(eq(Stock.id, stock!.id));
    expect(updated?.qty).toBe(0);
  });

  it('requires a note when the reason is Other; accepts one when given', async () => {
    const { stock, caller } = await seedStock(10);

    await expect(
      caller.stock.adjust({ stock_id: stock!.id, mode: 'set', target_qty: 8, reason_code: 'OTHER' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const result = await caller.stock.adjust({
      stock_id: stock!.id,
      mode: 'set',
      target_qty: 8,
      reason_code: 'OTHER',
      note: 'recount after spill cleanup',
    });
    expect(result.new_qty).toBe(8);
  });

  it('accepts the legacy shape (change_qty + reason, no mode / reason_code)', async () => {
    const { product, stock, caller } = await seedStock(10);
    const result = await caller.stock.adjust({ stock_id: stock!.id, change_qty: 4, reason: 'legacy client' });
    expect(result).toMatchObject({ mode: 'delta', reason_code: 'OTHER', new_qty: 14 });

    const [movement] = await db.select().from(StockMovement).where(eq(StockMovement.product_id, product!.id));
    expect(movement!.movement_type).toBe('ADJUSTMENT');
    expect(movement!.reason_code).toBe('OTHER');
    expect(movement!.reason).toBe('legacy client');
  });

  it('a concurrent set and delta against one row both land coherently — no lost update', async () => {
    const { stock, caller } = await seedStock(100);

    await Promise.all([
      caller.stock.adjust({ stock_id: stock!.id, mode: 'set', target_qty: 50, reason_code: 'PHYSICAL_COUNT' }),
      caller.stock.adjust({ stock_id: stock!.id, mode: 'delta', change_qty: 10, reason_code: 'FOUND' }),
    ]);

    const [final] = await db.select().from(Stock).where(eq(Stock.id, stock!.id));
    // Order isn't deterministic, but the row lock guarantees no torn write:
    // set-then-delta → 60; delta-then-set → 50. Never 100/110/lost.
    expect([50, 60]).toContain(final?.qty);

    const movements = await db.select().from(StockMovement).where(eq(StockMovement.location_id, stock!.location_id!));
    expect(movements).toHaveLength(2);
  });
});
