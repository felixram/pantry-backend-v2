import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../schemaHelpers.ts";
import { Category } from "./category.ts";
import { Tenant } from "./tenant.ts";
import { User } from "./users.ts";
import { relations } from "drizzle-orm";

export const CategoryAudit = pgTable(
  "category_audit",
  {
    id,
    // Nullable + ON DELETE SET NULL — mirrors ProductAudit.productId /
    // SupplierAudit.supplierId: categories can be truly hard-deleted by
    // purgeExpiredCategories.ts after the 24h restore window, and a
    // blocking FK here would defeat that purge.
    categoryId: uuid().references(() => Category.id, { onDelete: "set null" }),
    // Snapshot so the log still reads sensibly after a category is purged.
    categoryName: text().notNull(),
    // Denormalized (not derived via categoryId) so tenant-scoped queries
    // still work once categoryId goes null.
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
  (categoryAudit) => [
    index().on(categoryAudit.categoryId),
    index().on(categoryAudit.tenant_id),
    index().on(categoryAudit.createdAt),
  ],
);

export const CategoryAuditRelations = relations(CategoryAudit, ({ one }) => ({
  category: one(Category, {
    fields: [CategoryAudit.categoryId],
    references: [Category.id],
  }),
  user: one(User, {
    fields: [CategoryAudit.userId],
    references: [User.id],
  }),
  tenant: one(Tenant, {
    fields: [CategoryAudit.tenant_id],
    references: [Tenant.id],
  }),
}));
