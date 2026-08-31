import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, closeDatabase } from "../../db/index.js";
import { t } from "../../server/trpc.js";
import { appRouter } from "../../server/routers/index.js";
import { PurchaseOrder } from "../../db/schema/purchaseOrder.js";
import { Invoice } from "../../db/schema/invoice.js";
import { InvoiceItem } from "../../db/schema/invoiceItem.js";
import { Tenant } from "../../db/schema/tenant.js";
import { eq } from "drizzle-orm";
import { ROLES } from "../../types/user.js";
import {
  clearDatabase,
  getOrCreateTestTenant,
  createTestUser,
  createTestLocation,
  createTestSupplier,
  createTestProduct,
} from "../helpers/testDb.js";

const createCaller = t.createCallerFactory(appRouter);

function caller(user: { id: string; role: string }, tenantId: string, isDemoTenant = false) {
  return createCaller({
    req: {} as never,
    res: {} as never,
    db,
    user: { id: user.id, role: user.role },
    userLocationId: null,
    tenantId,
    isDemoTenant,
    clerkUserId: null,
    clerkOrgId: null,
    isOwner: false,
  });
}

describe("integration | multi-currency propagation", () => {
  beforeEach(async () => {
    await clearDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it("createWithItems snapshots the supplier's currency onto the PO", async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: "a@x.com" });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: "EUR Supplier", currency: "EUR" });
    const product = await createTestProduct({ name: "Thing" });

    const res = await caller(admin!, tenantId).purchaseOrder.createWithItems({
      supplier_id: supplier!.id,
      destination_location_id: location!.id,
      items: [{ product_id: product!.id, qty: 2, unit_price: 5, unit: "each" }],
    });

    const [po] = await db.select().from(PurchaseOrder).where(eq(PurchaseOrder.id, res.purchaseOrderId));
    expect(po!.currency).toBe("EUR");
  });

  it("createWithItems falls back to the tenant default when the supplier has none", async () => {
    const tenantId = await getOrCreateTestTenant();
    await db.update(Tenant).set({ default_currency: "GBP" }).where(eq(Tenant.id, tenantId));
    const admin = await createTestUser({ role: ROLES.admin, email: "a@x.com" });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: "No-currency Supplier" });
    const product = await createTestProduct({ name: "Thing" });

    const res = await caller(admin!, tenantId).purchaseOrder.createWithItems({
      supplier_id: supplier!.id,
      destination_location_id: location!.id,
      items: [{ product_id: product!.id, qty: 1, unit_price: 3, unit: "each" }],
    });

    const [po] = await db.select().from(PurchaseOrder).where(eq(PurchaseOrder.id, res.purchaseOrderId));
    expect(po!.currency).toBe("GBP");
  });

  it("confirmInvoice rejects an invoice/PO currency mismatch", async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: "a@x.com" });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: "S" });
    const product = await createTestProduct({ name: "P" });

    const [po] = await db
      .insert(PurchaseOrder)
      .values({
        po_number: "PO-CUR-1",
        supplier_id: supplier!.id,
        destination_location_id: location!.id,
        status: "ORDERED",
        currency: "USD",
        tenant_id: tenantId,
      })
      .returning();

    const [invoice] = await db
      .insert(Invoice)
      .values({
        tenant_id: tenantId,
        status: "REVIEW",
        currency: "EUR",
        matched_supplier_id: supplier!.id,
        matched_purchase_order_id: po!.id,
      })
      .returning();
    await db.insert(InvoiceItem).values({
      invoice_id: invoice!.id,
      extracted_name: "P",
      extracted_qty: 1,
      extracted_unit_price: 1,
      confirmed_product_id: product!.id,
      is_taxable: false,
    });

    await expect(
      caller(admin!, tenantId).invoice.confirm({ invoiceId: invoice!.id }),
    ).rejects.toThrow(/EUR.*USD|currenc/i);
  });

  it("tenant.updateSettings persists, validates, and is gated", async () => {
    const tenantId = await getOrCreateTestTenant();
    const admin = await createTestUser({ role: ROLES.admin, email: "admin@x.com" });
    const manager = await createTestUser({ role: ROLES.manager, email: "mgr@x.com" });

    const ok = await caller(admin!, tenantId).tenant.updateSettings({ default_currency: "eur" });
    expect(ok.default_currency).toBe("EUR");

    const read = await caller(admin!, tenantId).tenant.getSettings();
    expect(read.default_currency).toBe("EUR");

    await expect(
      caller(admin!, tenantId).tenant.updateSettings({ default_currency: "BANANA" }),
    ).rejects.toThrow(/unsupported/i);

    await expect(
      caller(manager!, tenantId).tenant.updateSettings({ default_currency: "USD" }),
    ).rejects.toThrow();

    await expect(
      caller(admin!, tenantId, true).tenant.updateSettings({ default_currency: "USD" }),
    ).rejects.toThrow(/demo/i);
  });

  it("report.purchaseOrderSummary filters to one currency and reports the excluded count", async () => {
    const tenantId = await getOrCreateTestTenant();
    await db.update(Tenant).set({ default_currency: "USD" }).where(eq(Tenant.id, tenantId));
    const admin = await createTestUser({ role: ROLES.admin, email: "admin@x.com" });
    const location = await createTestLocation();
    const supplier = await createTestSupplier({ name: "S" });

    for (const cur of ["USD", "USD", "EUR"] as const) {
      await db.insert(PurchaseOrder).values({
        po_number: `PO-${cur}-${Math.random().toString(36).slice(2, 7)}`,
        supplier_id: supplier!.id,
        destination_location_id: location!.id,
        status: "ORDERED",
        currency: cur,
        tenant_id: tenantId,
      });
    }

    const summary = await caller(admin!, tenantId).report.purchaseOrderSummary({ limit: 100 });
    expect(summary.currency).toBe("USD");
    expect(summary.total_orders).toBe(2);
    expect(summary.excluded_count).toBe(1);
    expect(summary.available_currencies.sort()).toEqual(["EUR", "USD"]);
  });
});
