import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm"
import { db } from "../../../../db/index.ts"
import { Supplier } from "../../../../db/schema/supplier.ts"
import { Tenant } from "../../../../db/schema/tenant.ts"
import { PurchaseOrder } from "../../../../db/schema/purchaseOrder.ts"
import { Invoice } from "../../../../db/schema/invoice.ts"
import { ProductAlias } from "../../../../db/schema/productAlias.ts"
import { SupplierInvoiceProfile } from "../../../../db/schema/supplierInvoiceProfile.ts"

export const SUPPLIER_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000

export async function purgeExpiredDeletedSuppliers(database: typeof db = db) {
  const cutoff = new Date(Date.now() - SUPPLIER_RESTORE_WINDOW_MS)

  const candidates = await database
    .select({ id: Supplier.id })
    .from(Supplier)
    .innerJoin(Tenant, eq(Supplier.tenant_id, Tenant.id))
    .where(
      and(isNotNull(Supplier.deletedAt), lt(Supplier.deletedAt, cutoff), eq(Tenant.is_demo, false), isNull(Tenant.deletedAt))
    )

  if (candidates.length === 0) return { checked: 0, purged: 0 }

  const candidateIds = candidates.map((c) => c.id)

  // Product.supplier_id is onDelete: "set null" so it's not a hard-delete
  // blocker — only these four (no onDelete cascade/set-null) actually block.
  const [purchaseOrders, invoices, aliases, invoiceProfiles] = await Promise.all([
    database.select({ supplierId: PurchaseOrder.supplier_id }).from(PurchaseOrder).where(inArray(PurchaseOrder.supplier_id, candidateIds)),
    database.select({ supplierId: Invoice.matched_supplier_id }).from(Invoice).where(inArray(Invoice.matched_supplier_id, candidateIds)),
    database.select({ supplierId: ProductAlias.supplier_id }).from(ProductAlias).where(inArray(ProductAlias.supplier_id, candidateIds)),
    database.select({ supplierId: SupplierInvoiceProfile.supplier_id }).from(SupplierInvoiceProfile).where(inArray(SupplierInvoiceProfile.supplier_id, candidateIds)),
  ])

  const referencedIds = new Set<string>()
  for (const row of purchaseOrders) if (row.supplierId) referencedIds.add(row.supplierId)
  for (const row of invoices) if (row.supplierId) referencedIds.add(row.supplierId)
  for (const row of aliases) if (row.supplierId) referencedIds.add(row.supplierId)
  for (const row of invoiceProfiles) if (row.supplierId) referencedIds.add(row.supplierId)

  const purgeableIds = candidateIds.filter((id) => !referencedIds.has(id))
  if (purgeableIds.length > 0) {
    await database.delete(Supplier).where(inArray(Supplier.id, purgeableIds))
  }

  return { checked: candidates.length, purged: purgeableIds.length }
}
