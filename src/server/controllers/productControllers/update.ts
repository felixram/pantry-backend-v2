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
      price: z.number().optional(),
      costPriceUnit: z.string().nullable().optional(),
      sellingPrice: z.number().optional(),
      sellingPriceUnit: z.string().nullable().optional(),
      description: z.string().optional(),
      defaultUnit: z.string().optional(),
      supplier_id: z.uuid().optional(),
      category_id: z.uuid().optional(),
      tax_rate_id: z.uuid().nullable().optional(),
      is_tax_exempt: z.boolean().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    return await ctx.db.transaction(async (tx) => {
      const existingProduct = await tx.query.Product.findFirst({
        where: eq(Product.id, input.productId),
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

      // Update core product fields (supplier, category, unit)
      const productUpdates: Record<string, any> = {};
      if (input.name) {
        productUpdates.name = input.name;
      }
      // Product.unit is not set here — syncProductUnits below is the only
      // thing that writes it, derived from the conversions it writes.
      if (input.supplier_id) {
        productUpdates.supplier_id = input.supplier_id;
      }
      if (input.category_id) {
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

      // Sync unit conversion entries (+ Product.unit) when the unit array is
      // updated. Surviving units keep their existing factor/base/purchasable;
      // brand-new units get defaults. syncProductUnits is the only place
      // that actually writes ProductUnitConversion or Product.unit.
      if (input.unit) {
        const existingConversions = await tx.query.ProductUnitConversion.findMany({
          where: and(
            eq(ProductUnitConversion.product_id, input.productId),
            eq(ProductUnitConversion.tenant_id, ctx.tenantId!),
          ),
        });
        const existingByName = new Map(existingConversions.map((c) => [c.unit_name, c]));

        const targetConversions = input.unit.map((unitName) => {
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

        await syncProductUnits(tx, {
          productId: input.productId,
          tenantId: ctx.tenantId!,
          conversions: targetConversions,
        });
      }

      // Get latest version for price/description updates
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
        costPrice: input?.price ?? latest.costPrice,
        versionNumber: latest.versionNumber,
      };

      // Check if any version-related fields have changed
      const priceChanged = input.price !== undefined && input.price !== latest.costPrice;
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
        newProductVersion.costPrice = input?.price ?? latest.costPrice;
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

      return {
        message: "Product updated",
      };
    });
  });
