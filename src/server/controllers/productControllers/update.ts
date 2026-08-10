import z from "zod";
import { authedMutation, t } from "../../trpc.ts";
import { and, eq, type InferInsertModel } from "drizzle-orm";
import { Product } from "../../../db/schema/product.ts";
import { TRPCError } from "@trpc/server";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts";
import { syncProductUnits } from "./helpers/syncProductUnits.ts";

export const updateProductProcedure = authedMutation
  .input(
    z.object({
      productId: z.uuid(),
      name: z.string().optional(),
      unit: z.array(z.string()).optional(),
      unitConversions: z
        .array(
          z.object({
            unit_name: z.string(),
            conversion_factor: z.number().positive(),
            is_base_unit: z.boolean(),
            is_purchasable: z.boolean().optional(),
          })
        )
        .optional(),
      costPrice: z.number().optional(),
      costPriceUnit: z.string().nullable().optional(),
      sellingPrice: z.number().optional(),
      sellingPriceUnit: z.string().nullable().optional(),
      description: z.string().optional(),
      defaultUnit: z.string().optional(),
      supplier_id: z.uuid().nullable().optional(),
      category_id: z.uuid().nullable().optional(),
      tax_rate_id: z.uuid().nullable().optional(),
      is_tax_exempt: z.boolean().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    return await ctx.db.transaction(async (tx) => {
      const existingProduct = await tx.query.Product.findFirst({
        where: and(eq(Product.id, input.productId), eq(Product.tenant_id, ctx.tenantId!)),
      });

      if (!existingProduct)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found.",
        });

      // Get the effective unit list for price unit validation
      const effectiveUnits = input.unit ?? existingProduct.unit ?? [];

      // Validate price units exist in the unit array
      if (input.costPriceUnit && !effectiveUnits.includes(input.costPriceUnit)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cost price unit "${input.costPriceUnit}" must be one of the product's units`,
        });
      }
      if (input.sellingPriceUnit && !effectiveUnits.includes(input.sellingPriceUnit)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Selling price unit "${input.sellingPriceUnit}" must be one of the product's units`,
        });
      }

      // Update core product fields (supplier, category, etc.)
      const productUpdates: Record<string, any> = {};
      if (input.name) {
        productUpdates.name = input.name;
      }
      // Product.unit is not set here — syncProductUnits below is the only
      // thing that writes it, derived from the conversions it writes.
      if (input.supplier_id !== undefined) {
        productUpdates.supplier_id = input.supplier_id;
      }
      if (input.category_id !== undefined) {
        productUpdates.category_id = input.category_id;
      }
      if (input.defaultUnit !== undefined) {
        productUpdates.defaultUnit = input.defaultUnit;
      }
      if (input.tax_rate_id !== undefined) {
        productUpdates.tax_rate_id = input.tax_rate_id;
      }
      if (input.is_tax_exempt !== undefined) {
        productUpdates.is_tax_exempt = input.is_tax_exempt;
      }

      if (Object.keys(productUpdates).length > 0) {
        await tx
          .update(Product)
          .set(productUpdates)
          .where(eq(Product.id, input.productId));
      }

      // Version (price/description) changes must land — and activeVersionId
      // repoint to it — BEFORE the unit-sync block below: syncProductUnits's
      // internal price-unit guard reads whatever version is active *right
      // now* in this transaction. Doing this first means a single request
      // that changes both costPriceUnit and unit together is checked against
      // its own new costPriceUnit, not a stale one about to be replaced.
      const [latest] = await tx
        .select()
        .from(ProductVersion)
        .where(
          eq(ProductVersion.id, existingProduct.activeVersionId as string)
        );

      if (!latest)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Ops, something happened when finding the most recent version of the product!",
        });

      const nextVersion = (latest.versionNumber ?? 0) + 1;

      const newProductVersion: InferInsertModel<typeof ProductVersion> = {
        costPrice: input?.costPrice ?? latest.costPrice,
        versionNumber: latest.versionNumber,
      };

      // Check if any version-related fields have changed
      const priceChanged = input.costPrice !== undefined && input.costPrice !== latest.costPrice;
      const sellingPriceChanged = input.sellingPrice !== undefined && input.sellingPrice !== latest.sellingPrice;
      const descriptionChanged = input.description !== undefined && input.description !== latest.description;
      const costPriceUnitChanged = input.costPriceUnit !== undefined && input.costPriceUnit !== latest.costPriceUnit;
      const sellingPriceUnitChanged = input.sellingPriceUnit !== undefined && input.sellingPriceUnit !== latest.sellingPriceUnit;

      if (
        priceChanged ||
        sellingPriceChanged ||
        descriptionChanged ||
        costPriceUnitChanged ||
        sellingPriceUnitChanged
      ) {
        newProductVersion.costPrice = input?.costPrice ?? latest.costPrice;
        newProductVersion.costPriceUnit = input.costPriceUnit !== undefined
          ? input.costPriceUnit
          : latest.costPriceUnit;
        newProductVersion.sellingPrice =
          input?.sellingPrice ?? latest.sellingPrice;
        newProductVersion.sellingPriceUnit = input.sellingPriceUnit !== undefined
          ? input.sellingPriceUnit
          : latest.sellingPriceUnit;
        newProductVersion.description =
          input?.description ?? latest.description;
        newProductVersion.versionNumber = nextVersion;
        newProductVersion.productId = existingProduct.id;
      }

      if (newProductVersion.versionNumber !== latest.versionNumber) {
        const [newVersion] = await tx
          .insert(ProductVersion)
          .values(newProductVersion)
          .returning({ id: ProductVersion.id });

        // Update product's active version
        await tx
          .update(Product)
          .set({
            activeVersionId: newVersion?.id,
          })
          .where(eq(Product.id, input.productId));
      }

      // Sync unit conversion entries (+ Product.unit) when the unit array is
      // updated. syncProductUnits is the only place that actually writes
      // ProductUnitConversion or Product.unit, and it also guards against
      // orphaning the (now-current) version's price units and clears any
      // stale Stock.display_unit values.
      if (input.unit) {
        let targetConversions;

        if (input.unitConversions) {
          // Caller sent the full desired conversions (factor/base/purchasable
          // included) — e.g. the edit UI, which always has complete state
          // since it's a controlled form, not a diff. Use it as-is (defaulting
          // an omitted is_purchasable to true, same as syncProductUnits does
          // at insert time, so exactOptionalPropertyTypes doesn't see an
          // explicit `undefined` where the target type wants boolean|absent).
          targetConversions = input.unitConversions.map((c) => ({
            unit_name: c.unit_name,
            conversion_factor: c.conversion_factor,
            is_base_unit: c.is_base_unit,
            is_purchasable: c.is_purchasable ?? true,
          }));
        } else {
          // Caller sent only unit names — reconstruct conversions by merging
          // with whatever's already in the DB: surviving units keep their
          // existing factor/base/purchasable, brand-new units get defaults.
          const existingConversions = await tx.query.ProductUnitConversion.findMany({
            where: and(
              eq(ProductUnitConversion.product_id, input.productId),
              eq(ProductUnitConversion.tenant_id, ctx.tenantId!),
            ),
          });
          const existingByName = new Map(existingConversions.map((c) => [c.unit_name, c]));

          targetConversions = input.unit.map((unitName) => {
            const existing = existingByName.get(unitName);
            return existing
              ? {
                  unit_name: unitName,
                  conversion_factor: existing.conversion_factor,
                  is_base_unit: existing.is_base_unit,
                  is_purchasable: existing.is_purchasable,
                }
              : { unit_name: unitName, conversion_factor: 1, is_base_unit: false, is_purchasable: true };
          });
        }

        await syncProductUnits(tx, {
          productId: input.productId,
          tenantId: ctx.tenantId!,
          conversions: targetConversions,
        });
      }

      return {
        message: "Product updated",
      };
    });
  });
