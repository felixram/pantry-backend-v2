import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { createdAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Tenant } from "./tenant.ts"
import { Location } from "./location.ts"

export const TenantInvoiceConfig = pgTable(
  "tenant_invoice_config",
  {
    id,
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    inbound_email_address: text("inbound_email_address").notNull().unique(),
    allowed_sender_domains: text("allowed_sender_domains").array(),
    default_location_id: uuid("default_location_id").references(() => Location.id),
    auto_match_enabled: boolean("auto_match_enabled").notNull().default(true),
    require_po_match: boolean("require_po_match").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("tenant_invoice_config_tenant_unique").on(t.tenant_id),
    index().on(t.inbound_email_address),
  ]
)

export const TenantInvoiceConfigRelations = relations(TenantInvoiceConfig, ({ one }) => ({
  tenant: one(Tenant, {
    fields: [TenantInvoiceConfig.tenant_id],
    references: [Tenant.id],
  }),
  defaultLocation: one(Location, {
    fields: [TenantInvoiceConfig.default_location_id],
    references: [Location.id],
  }),
}))
