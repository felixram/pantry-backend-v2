import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../schemaHelpers.ts";
import { Product } from "./product.ts";
import { Tenant } from "./tenant.ts";
import { User } from "./users.ts";
import { relations } from "drizzle-orm";

export const ProductAudit = pgTable(
  "product_audit",
  {
    id,
    // Nullable + ON DELETE SET NULL (not NOT NULL/no-action like
    // PurchaseOrderAudit.purchaseOrderId) because products can be truly
    // hard-deleted by purgeExpiredProducts.ts after the 24h restore window.
    // A blocking FK here would defeat that purge for every deleted product.
    productId: uuid().references(() => Product.id, { onDelete: "set null" }),
    // Snapshots so the log still reads sensibly after a product is purged.
    productName: text().notNull(),
    productSku: text(),
    // Denormalized (not derived via productId) so tenant-scoped queries
    // still work once productId goes null.
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
  (productAudit) => [
    index().on(productAudit.productId),
    index().on(productAudit.tenant_id),
    index().on(productAudit.createdAt),
  ],
);

export const ProductAuditRelations = relations(ProductAudit, ({ one }) => ({
  product: one(Product, {
    fields: [ProductAudit.productId],
    references: [Product.id],
  }),
  user: one(User, {
    fields: [ProductAudit.userId],
    references: [User.id],
  }),
  tenant: one(Tenant, {
    fields: [ProductAudit.tenant_id],
    references: [Tenant.id],
  }),
}));
