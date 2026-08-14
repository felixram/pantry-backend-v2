import { boolean, index, integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { createdAt, deletedAt, id, updatedAt } from "../schemaHelpers.ts"
import { relations } from "drizzle-orm"
import { Stock } from "./stock.ts"
import { StockMovement } from "./stockMovement.ts"
import { User } from "./users.ts"
import { Tenant } from "./tenant.ts"
import { TaxRate } from "./taxRate.ts"

export const Location = pgTable(
  "location",
  {
    id,
    name: text().notNull(),
    address: text().notNull(),
    city: text(),
    state: text(),
    postalCode: text(),
    country: text(),
    latitude: real(),
    longitude: real(),
    place_id: text().unique(),
    inbound_email_slug: text("inbound_email_slug").unique(),
    active: boolean().default(true),
    // Weekly inventory count reminder schedule (per-location)
    count_reminder_enabled: boolean("count_reminder_enabled").default(false),
    count_reminder_day: integer("count_reminder_day"),   // 0=Sun … 6=Sat
    count_reminder_time: text("count_reminder_time"),    // "HH:MM" in count_reminder_tz
    count_reminder_tz: text("count_reminder_tz"),        // IANA tz, e.g. "America/New_York"
    count_designated_user_id: uuid("count_designated_user_id").references(() => User.id),
    // System-written only, by the reminder cron itself — never exposed via
    // location.update. Idempotency guard (skip a location whose reminder
    // already went out this ISO week) plus the "last sent" timestamp shown
    // in the config UI.
    last_reminder_sent_week_identifier: text("last_reminder_sent_week_identifier"),
    last_reminder_sent_at: timestamp("last_reminder_sent_at", { withTimezone: true }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    default_purchase_tax_rate_id: uuid("default_purchase_tax_rate_id").references(() => TaxRate.id),
    default_sales_tax_rate_id: uuid("default_sales_tax_rate_id").references(() => TaxRate.id),
    createdAt,
    updatedAt,
    deletedAt,
    deletedBy: uuid().references(() => User.id),
  },
  (loc) => [
    index().on(loc.name),
    index().on(loc.address),
    index().on(loc.place_id),
    index().on(loc.tenant_id),
    index().on(loc.deletedAt),
  ]
)

export const LocationRelationships = relations(Location, ({ many, one }) => ({
  stock: many(Stock),
  stockMovements: many(StockMovement),
  users: many(User), // Users assigned to this location
  tenant: one(Tenant, {
    fields: [Location.tenant_id],
    references: [Tenant.id],
  }),
  defaultPurchaseTaxRate: one(TaxRate, {
    fields: [Location.default_purchase_tax_rate_id],
    references: [TaxRate.id],
    relationName: "locationPurchaseTax",
  }),
  defaultSalesTaxRate: one(TaxRate, {
    fields: [Location.default_sales_tax_rate_id],
    references: [TaxRate.id],
    relationName: "locationSalesTax",
  }),
}))
