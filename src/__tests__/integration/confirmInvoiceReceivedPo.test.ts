import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDatabase } from '../../db/index.js';
import { t } from '../../server/trpc.js';
import { appRouter } from '../../server/routers/index.js';
import { PurchaseOrder } from '../../db/schema/purchaseOrder.js';
import { PurchaseOrderItem } from '../../db/schema/purchaseOrderItem.js';
import { Invoice } from '../../db/schema/invoice.js';
import { InvoiceItem } from '../../db/schema/invoiceItem.js';
import { StockMovement } from '../../db/schema/stockMovement.js';
import { Stock } from '../../db/schema/stock.js';
import { eq, and, count } from 'drizzle-orm';
import { ROLES } from '../../types/user.js';
import {
  clearDatabase,
  getOrCreateTestTenant,
  createTestUser,
  createTestLocation,
  createTestSupplier,
  createTestProduct,
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

describe('integration | confirm invoice attached to an already-RECEIVED PO', () => {
  beforeEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('reconciles prices + totals with no stock movement when the qty already matches', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: 'Acme' });
    const product = await createTestProduct({ name: 'Widget' });

    const [po] = await db
      .insert(PurchaseOrder)
      .values({
        po_number: 'PO-RCV-1',
        supplier_id: supplier!.id,
        destination_location_id: location!.id,
        status: 'RECEIVED',
        subtotal: 50,
        total: 50,
        tenant_id: tenantId,
      })
      .returning();
    const [poItem] = await db
      .insert(PurchaseOrderItem)
      .values({ purchase_order_id: po!.id, product_id: product!.id, qty: 10, unit_price: 5, received_qty: 10 })
      .returning();

    const [invoice] = await db
      .insert(Invoice)
      .values({
        tenant_id: tenantId,
        location_id: location!.id,
        status: 'REVIEW',
        matched_supplier_id: supplier!.id,
        matched_purchase_order_id: po!.id,
        subtotal: 60,
        tax_amount: 6,
        total: 66,
      })
      .returning();
    await db.insert(InvoiceItem).values({
      invoice_id: invoice!.id,
      extracted_name: 'Widget',
      extracted_qty: 10,
      extracted_unit_price: 6,
      confirmed_product_id: product!.id,
      confirmed_qty: 10,
      confirmed_unit_price: 6,
      matched_po_item_id: poItem!.id,
      is_taxable: false,
    });

    const [before] = await db.select({ n: count() }).from(StockMovement);

    const result = await caller(admin!, tenantId).invoice.confirm({ invoiceId: invoice!.id });
    expect(result.message).toMatch(/reconcil|no stock/i);

    const [after] = await db.select({ n: count() }).from(StockMovement);
    expect(Number(after!.n)).toBe(Number(before!.n)); // no stock moved

    const [poAfter] = await db.select().from(PurchaseOrder).where(eq(PurchaseOrder.id, po!.id));
    expect(poAfter!.subtotal).toBe(60);
    expect(poAfter!.total).toBe(66);
    expect(poAfter!.status).toBe('RECEIVED'); // unchanged

    const [itemAfter] = await db
      .select()
      .from(PurchaseOrderItem)
      .where(eq(PurchaseOrderItem.id, poItem!.id));
    expect(itemAfter!.unit_price).toBe(6); // reconciled to the billed price

    const [invAfter] = await db.select().from(Invoice).where(eq(Invoice.id, invoice!.id));
    expect(invAfter!.status).toBe('APPLIED');
  });

  it('applies the qty delta to stock when the invoice qty differs from what was received', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: 'Acme' });
    const product = await createTestProduct({ name: 'Widget' });

    const [po] = await db
      .insert(PurchaseOrder)
      .values({
        po_number: 'PO-RCV-2',
        supplier_id: supplier!.id,
        destination_location_id: location!.id,
        status: 'RECEIVED',
        tenant_id: tenantId,
      })
      .returning();
    // Ordered + received 10; stock already carries those 10.
    const [poItem] = await db
      .insert(PurchaseOrderItem)
      .values({ purchase_order_id: po!.id, product_id: product!.id, qty: 10, unit_price: 5, received_qty: 10 })
      .returning();
    await db
      .insert(Stock)
      .values({ location_id: location!.id, productId: product!.id, qty: 10, minimumStockLevel: 0, tenant_id: tenantId });

    // Invoice says 12 were actually delivered.
    const [invoice] = await db
      .insert(Invoice)
      .values({
        tenant_id: tenantId,
        location_id: location!.id,
        status: 'REVIEW',
        matched_supplier_id: supplier!.id,
        matched_purchase_order_id: po!.id,
        subtotal: 60,
        total: 60,
      })
      .returning();
    await db.insert(InvoiceItem).values({
      invoice_id: invoice!.id,
      extracted_name: 'Widget',
      extracted_qty: 12,
      extracted_unit_price: 5,
      confirmed_product_id: product!.id,
      confirmed_qty: 12,
      confirmed_unit_price: 5,
      matched_po_item_id: poItem!.id,
      is_taxable: false,
    });

    const [before] = await db.select({ n: count() }).from(StockMovement);
    const result = await caller(admin!, tenantId).invoice.confirm({ invoiceId: invoice!.id });
    expect(result.message).toMatch(/reconcil/i);

    // Exactly one movement, for the +2 delta — not the full 12.
    const [after] = await db.select({ n: count() }).from(StockMovement);
    expect(Number(after!.n)).toBe(Number(before!.n) + 1);
    const [mv] = await db
      .select()
      .from(StockMovement)
      .where(and(eq(StockMovement.product_id, product!.id), eq(StockMovement.location_id, location!.id)));
    expect(mv!.change_qty).toBe(2);

    const [stockAfter] = await db
      .select()
      .from(Stock)
      .where(and(eq(Stock.productId, product!.id), eq(Stock.location_id, location!.id)));
    expect(stockAfter!.qty).toBe(12); // 10 + 2, not 10 + 12

    const [itemAfter] = await db
      .select()
      .from(PurchaseOrderItem)
      .where(eq(PurchaseOrderItem.id, poItem!.id));
    expect(itemAfter!.received_qty).toBe(12);
  });

  it('still rejects an invoice attached to a CANCELLED PO', async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: 'admin@x.com' });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: 'Acme' });
    const product = await createTestProduct({ name: 'Widget' });

    const [po] = await db
      .insert(PurchaseOrder)
      .values({
        po_number: 'PO-CAN-1',
        supplier_id: supplier!.id,
        destination_location_id: location!.id,
        status: 'CANCELLED',
        tenant_id: tenantId,
      })
      .returning();

    const [invoice] = await db
      .insert(Invoice)
      .values({
        tenant_id: tenantId,
        location_id: location!.id,
        status: 'REVIEW',
        matched_supplier_id: supplier!.id,
        matched_purchase_order_id: po!.id,
      })
      .returning();
    await db.insert(InvoiceItem).values({
      invoice_id: invoice!.id,
      extracted_name: 'Widget',
      extracted_qty: 1,
      extracted_unit_price: 1,
      confirmed_product_id: product!.id,
      is_taxable: false,
    });

    await expect(
      caller(admin!, tenantId).invoice.confirm({ invoiceId: invoice!.id }),
    ).rejects.toThrow(/CANCELLED/i);
  });
});
