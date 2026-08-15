import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "../schemaHelpers.ts";
import { TaxRate } from "./taxRate.ts";
import { Tenant } from "./tenant.ts";
import { User } from "./users.ts";
import { relations } from "drizzle-orm";

export const TaxRateAudit = pgTable(
  "tax_rate_audit",
  {
    id,
    // Nullable + ON DELETE SET NULL — mirrors CategoryAudit.categoryId: tax
    // rates can be truly hard-deleted by purgeExpiredTaxRates.ts after the
    // 24h restore window (once no product/category/location still
    // references them), and a blocking FK here would defeat that purge.
    taxRateId: uuid().references(() => TaxRate.id, { onDelete: "set null" }),
    // Snapshot so the log still reads sensibly after a tax rate is purged.
    taxRateName: text().notNull(),
    // Denormalized (not derived via taxRateId) so tenant-scoped queries
    // still work once taxRateId goes null.
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
  (taxRateAudit) => [
    index().on(taxRateAudit.taxRateId),
    index().on(taxRateAudit.tenant_id),
    index().on(taxRateAudit.createdAt),
  ],
);

export const TaxRateAuditRelations = relations(TaxRateAudit, ({ one }) => ({
  taxRate: one(TaxRate, {
    fields: [TaxRateAudit.taxRateId],
    references: [TaxRate.id],
  }),
  user: one(User, {
    fields: [TaxRateAudit.userId],
    references: [User.id],
  }),
  tenant: one(Tenant, {
    fields: [TaxRateAudit.tenant_id],
    references: [Tenant.id],
  }),
}));
