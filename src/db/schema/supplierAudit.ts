import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../schemaHelpers.ts";
import { Supplier } from "./supplier.ts";
import { Tenant } from "./tenant.ts";
import { User } from "./users.ts";
import { relations } from "drizzle-orm";

export const SupplierAudit = pgTable(
  "supplier_audit",
  {
    id,
    // Nullable + ON DELETE SET NULL — mirrors ProductAudit.productId: suppliers
    // can be truly hard-deleted by purgeExpiredSuppliers.ts after the 24h
    // restore window, and a blocking FK here would defeat that purge.
    supplierId: uuid().references(() => Supplier.id, { onDelete: "set null" }),
    // Snapshot so the log still reads sensibly after a supplier is purged.
    supplierName: text().notNull(),
    // Denormalized (not derived via supplierId) so tenant-scoped queries
    // still work once supplierId goes null.
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    action: text().notNull(), // "deleted" | "restored"
    userId: uuid()
      .references(() => User.id)
      .notNull(),
    reason: text(),
    createdAt,
  },
  (supplierAudit) => [
    index().on(supplierAudit.supplierId),
    index().on(supplierAudit.tenant_id),
    index().on(supplierAudit.createdAt),
  ],
);

export const SupplierAuditRelations = relations(SupplierAudit, ({ one }) => ({
  supplier: one(Supplier, {
    fields: [SupplierAudit.supplierId],
    references: [Supplier.id],
  }),
  user: one(User, {
    fields: [SupplierAudit.userId],
    references: [User.id],
  }),
  tenant: one(Tenant, {
    fields: [SupplierAudit.tenant_id],
    references: [Tenant.id],
  }),
}));
