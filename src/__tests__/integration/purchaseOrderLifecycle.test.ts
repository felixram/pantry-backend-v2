import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDatabase } from '../../db/index.js';
import { t } from '../../server/trpc.js';
import { appRouter } from '../../server/routers/index.js';
import { Stock } from '../../db/schema/stock.js';
import { PurchaseOrderItem } from '../../db/schema/purchaseOrderItem.js';
import { StockMovement } from '../../db/schema/stockMovement.js';
import { eq, and } from 'drizzle-orm';
import { clearDatabase, createTestUser, createTestLocation, createTestSupplier, createTestProduct } from '../helpers/testDb.js';
import { ROLES } from '../../types/user.js';

const createCaller = t.createCallerFactory(appRouter);

function callerFor(user: { id: string; role: string }, tenantId: string, userLocationId: string | null = null) {
  return createCaller({
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
}

// Real Postgres required — see .github/workflows/ci.yml's postgres service.
// Runs against testDb.ts (previously dead code) instead of mocking Drizzle,
// because the thing actually under test — receivePurchaseOrder's atomic
// upsert, partial-receiving coverage math, and the real PO state machine —
// is exactly the kind of logic a deep mock can't meaningfully verify.
describe('integration | PO lifecycle: create -> order -> partial receive -> full receive', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('takes an ADMIN-created PO from APPROVED through ORDERED, PARTIALLY_RECEIVED, and RECEIVED, with correct stock at every step', async () => {
    const location = await createTestLocation();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const admin = await createTestUser({ role: ROLES.admin });

    const caller = callerFor(admin!, admin!.tenant_id);

    // 1. Create — ADMIN-authored POs start APPROVED (self-approval skip).
    const created = await caller.purchaseOrder.createWithItems({
      supplier_id: supplier!.id,
      destination_location_id: location!.id,
      items: [{ product_id: product!.id, qty: 10, unit_price: 5 }],
    });
    const poId = created.purchaseOrderId;

    const afterCreate = await caller.purchaseOrder.getById({ id: poId });
    expect(afterCreate.status).toBe('APPROVED');

    // 2. Mark as ORDERED.
    const afterOrdered = await caller.purchaseOrder.update({ purchaseOrderId: poId, status: 'ORDERED' });
    expect(afterOrdered.status).toBe('ORDERED');

    const [item] = await db
      .select()
      .from(PurchaseOrderItem)
      .where(and(eq(PurchaseOrderItem.purchase_order_id, poId), eq(PurchaseOrderItem.product_id, product!.id)));
    expect(item).toBeDefined();

    // 3. Partial receive: 6 of 10.
    const afterPartial = await caller.purchaseOrder.update({
      purchaseOrderId: poId,
      receivedItems: [{ itemId: item!.id, receivedQty: 6 }],
    });
    expect(afterPartial.status).toBe('PARTIALLY_RECEIVED');

    const [stockAfterPartial] = await db
      .select()
      .from(Stock)
      .where(and(eq(Stock.productId, product!.id), eq(Stock.location_id, location!.id)));
    expect(stockAfterPartial?.qty).toBe(6);

    const [itemAfterPartial] = await db.select().from(PurchaseOrderItem).where(eq(PurchaseOrderItem.id, item!.id));
    expect(itemAfterPartial?.received_qty).toBe(6);

    const movementsAfterPartial = await db
      .select()
      .from(StockMovement)
      .where(and(eq(StockMovement.product_id, product!.id), eq(StockMovement.movement_type, 'PO_RECEIVE')));
    expect(movementsAfterPartial).toHaveLength(1);
    expect(movementsAfterPartial[0]!.change_qty).toBe(6);

    // 4. Receive the remaining 4 — completes the order.
    const afterFull = await caller.purchaseOrder.update({
      purchaseOrderId: poId,
      receivedItems: [{ itemId: item!.id, receivedQty: 4 }],
    });
    expect(afterFull.status).toBe('RECEIVED');

    const [stockAfterFull] = await db
      .select()
      .from(Stock)
      .where(and(eq(Stock.productId, product!.id), eq(Stock.location_id, location!.id)));
    // Accumulated across both receiving events, not overwritten: 6 + 4 = 10.
    expect(stockAfterFull?.qty).toBe(10);

    const [itemAfterFull] = await db.select().from(PurchaseOrderItem).where(eq(PurchaseOrderItem.id, item!.id));
    expect(itemAfterFull?.received_qty).toBe(10);

    const movementsAfterFull = await db
      .select()
      .from(StockMovement)
      .where(and(eq(StockMovement.product_id, product!.id), eq(StockMovement.movement_type, 'PO_RECEIVE')));
    // A second, separate movement row for the second receiving event —
    // accumulation happens on Stock.qty, not by collapsing movement history.
    expect(movementsAfterFull).toHaveLength(2);
  });

  it('rejects a USER attempting to cancel an ORDERED PO — the state machine is enforced end-to-end, not just at the unit level', async () => {
    const location = await createTestLocation();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin2@test.local' });
    const staffUser = await createTestUser({ role: ROLES.user, email: 'staff@test.local', location_id: location!.id });

    const adminCaller = callerFor(admin!, admin!.tenant_id);
    const created = await adminCaller.purchaseOrder.createWithItems({
      supplier_id: supplier!.id,
      destination_location_id: location!.id,
      items: [{ product_id: product!.id, qty: 5, unit_price: 1 }],
    });
    await adminCaller.purchaseOrder.update({ purchaseOrderId: created.purchaseOrderId, status: 'ORDERED' });

    const userCaller = callerFor(staffUser!, staffUser!.tenant_id, location!.id);
    await expect(
      userCaller.purchaseOrder.update({ purchaseOrderId: created.purchaseOrderId, status: 'CANCELLED' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
