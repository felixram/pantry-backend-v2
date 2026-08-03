import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, deletedAt } from "../schemaHelpers.ts";
import { Category } from "./category.ts";
import { Supplier } from "./supplier.ts";
import { Tenant } from "./tenant.ts";
import { relations, sql } from "drizzle-orm";
import { ProductVersion } from "./productVersion.ts";
import { ProductUnitConversion } from "./productUnitConversion.ts";
import { Stock } from "./stock.ts";
import { TaxRate } from "./taxRate.ts";

export const Product = pgTable(
  "product",
  {
    id,
    sku: text(),
    name: text().notNull(),
    category_id: uuid().references(() => Category.id, { onDelete: "set null" }),
    supplier_id: uuid().references(() => Supplier.id, { onDelete: "set null" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => Tenant.id),
    unit: text().array().notNull(),
    // Last used unit type, becomes default for future orders
    defaultUnit: text(),
    activeVersionId: uuid(),
    tax_rate_id: uuid("tax_rate_id").references(() => TaxRate.id),
    is_tax_exempt: boolean("is_tax_exempt").default(false),
    createdAt,
    updatedAt,
    deletedAt,
  },
  (product) => [
    index().on(product.name),
    index().on(product.sku),
    index().on(product.category_id),
    index().on(product.supplier_id),
    index().on(product.tenant_id),
    index().on(product.activeVersionId),
    index().on(product.deletedAt),
    uniqueIndex("product_sku_tenant_unique")
      .on(product.sku, product.tenant_id)
      .where(sql`"deletedAt" IS NULL`),
  ],
);

export const ProductRelations = relations(Product, ({ one, many }) => ({
  supplier: one(Supplier, {
    fields: [Product.supplier_id],
    references: [Supplier.id],
  }),
  category: one(Category, {
    fields: [Product.category_id],
    references: [Category.id],
  }),
  version: one(ProductVersion, {
    fields: [Product.activeVersionId],
    references: [ProductVersion.id],
  }),
  tenant: one(Tenant, {
    fields: [Product.tenant_id],
    references: [Tenant.id],
  }),
  unitConversions: many(ProductUnitConversion),
  taxRate: one(TaxRate, {
    fields: [Product.tax_rate_id],
    references: [TaxRate.id],
  }),
}));
