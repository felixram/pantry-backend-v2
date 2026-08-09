import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { and, eq, isNull } from "drizzle-orm";
import { Product } from "../../../db/schema/product.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { Category } from "../../../db/schema/category.ts";
import { TaxRate } from "../../../db/schema/taxRate.ts";
import { TRPCError } from "@trpc/server";
import { handleDbError } from "../../../utils/dbErrors.ts";
import { syncProductUnits } from "./helpers/syncProductUnits.ts";

export const createProductProcedure = authedMutation
  .input(
    z.object({
      sku: z.string().optional(),
      name: z.string(),
      unit: z.array(z.string()),
      costPrice: z.number().optional(),
      costPriceUnit: z.string().optional(),
      sellingPrice: z.number().optional(),
      sellingPriceUnit: z.string().optional(),
      description: z.string().optional(),
      supplier_id: z.uuid().optional(),
      category_id: z.string().optional(),
      tax_rate_id: z.string().uuid().nullable().optional(),
      is_tax_exempt: z.boolean().optional(),
      unitConversions: z.array(z.object({
        unit_name: z.string(),
        conversion_factor: z.number().positive(),
        is_base_unit: z.boolean(),
        is_purchasable: z.boolean().optional(),
      })).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Validate price units exist in the unit array
    if (input.costPriceUnit && !input.unit.includes(input.costPriceUnit)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cost price unit "${input.costPriceUnit}" must be one of the product's units`,
      });
    }
    if (input.sellingPriceUnit && !input.unit.includes(input.sellingPriceUnit)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Selling price unit "${input.sellingPriceUnit}" must be one of the product's units`,
      });
    }

    // Referenced ids must belong to this tenant — without this, a cross-tenant
    // id (e.g. copied from another tenant's browser session) would be accepted
    // silently, since the DB's FK constraints only check the row exists
    // somewhere, not that it's scoped to the caller's tenant.
    const [supplierExists, categoryExists, taxRateExists] = await Promise.all([
      input.supplier_id
        ? ctx.db.query.Supplier.findFirst({
            where: and(
              eq(Supplier.id, input.supplier_id),
              eq(Supplier.tenant_id, ctx.tenantId),
              isNull(Supplier.deletedAt),
            ),
            columns: { id: true },
          })
        : null,
      input.category_id
        ? ctx.db.query.Category.findFirst({
            where: and(eq(Category.id, input.category_id), eq(Category.tenant_id, ctx.tenantId)),
            columns: { id: true },
          })
        : null,
      input.tax_rate_id
        ? ctx.db.query.TaxRate.findFirst({
            where: and(
              eq(TaxRate.id, input.tax_rate_id),
              eq(TaxRate.tenant_id, ctx.tenantId),
              isNull(TaxRate.deletedAt),
            ),
            columns: { id: true },
          })
        : null,
    ]);

    if (input.supplier_id && !supplierExists) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
    }
    if (input.category_id && !categoryExists) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
    }
    if (input.tax_rate_id && !taxRateExists) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Tax rate not found" });
    }

    // No SKU-duplicate pre-check here on purpose: a check-then-insert has a
    // race window (two concurrent requests can both pass the check before
    // either inserts). The partial unique index on (sku, tenant_id) is the
    // actual source of truth; a violation is caught below and turned into
    // the same friendly message.
    try {
      return await ctx.db.transaction(async (tx) => {
        const [newProduct] = await tx
          .insert(Product)
          .values({
            name: input.name,
            sku: input.sku ?? null,
            // Placeholder to satisfy NOT NULL — syncProductUnits below is the
            // only thing that actually derives this column, from whatever
            // conversions end up written.
            unit: [],
            supplier_id: input.supplier_id ?? null,
            category_id: input.category_id ?? null,
            tax_rate_id: input.tax_rate_id ?? null,
            is_tax_exempt: input.is_tax_exempt ?? false,
            tenant_id: ctx.tenantId!,
          })
          .returning({ id: Product.id });

        const [newVersion] = await tx
          .insert(ProductVersion)
          .values({
            productId: newProduct?.id,
            versionNumber: 1,
            costPrice: input.costPrice ?? 0.0,
            costPriceUnit: input.costPriceUnit ?? null,
            sellingPrice: input.sellingPrice ?? null,
            sellingPriceUnit: input.sellingPriceUnit ?? null,
            description: input.description,
          })
          .returning({ id: ProductVersion.id });

        // Must repoint activeVersionId to the new version BEFORE calling
        // syncProductUnits: its internal price-unit guard reads whatever
        // version is currently active, so it needs to see this one (with
        // this request's costPriceUnit/sellingPriceUnit), not stay pointed
        // at nothing/stale — otherwise a product created with units AND a
        // costPriceUnit together could false-positive-block itself.
        if (newVersion && newProduct) {
          await tx.update(Product).set({ activeVersionId: newVersion.id }).where(eq(Product.id, newProduct.id));
        }

        if (newProduct && input.unit.length > 0) {
          const conversionsMap = new Map((input.unitConversions ?? []).map((c) => [c.unit_name, c]));
          await syncProductUnits(tx, {
            productId: newProduct.id,
            tenantId: ctx.tenantId!,
            conversions: input.unit.map((unit, index) => {
              const provided = conversionsMap.get(unit);
              return {
                unit_name: unit,
                conversion_factor: provided?.conversion_factor ?? 1,
                is_base_unit: provided?.is_base_unit ?? index === 0,
                is_purchasable: provided?.is_purchasable ?? true,
              };
            }),
          });
        }

        return {
          message: "Product created",
          productId: newProduct?.id,
          versionId: newVersion?.id,
        };
      });
    } catch (error) {
      throw handleDbError(error, {
        uniqueViolation: "This product already exists",
      });
    }
  });
