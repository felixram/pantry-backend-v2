import z from "zod";
import { authedMutation, t } from "../../trpc.ts";
import { and, eq, isNull } from "drizzle-orm";
import { Product } from "../../../db/schema/product.ts";
import { ProductVersion } from "../../../db/schema/productVersion.ts";
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts";
import { TRPCError } from "@trpc/server";

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

    // Check for existing product with same SKU within this tenant
    const existingProduct = input.sku
      ? await ctx.db.query.Product.findFirst({
          where: and(
            eq(Product.sku, input.sku),
            eq(Product.tenant_id, ctx.tenantId),
            isNull(Product.deletedAt)
          ),
        })
      : null;

    if (existingProduct)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This product already exists",
      });

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

    return await ctx.db.transaction(async (tx) => {
      const [newProduct] = await tx
        .insert(Product)
        .values({
          name: input.name,
          sku: input.sku ?? null,
          unit: input.unit ?? [],
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

      if (newVersion && newProduct)
        await tx
          .update(Product)
          .set({ activeVersionId: newVersion.id })
          .where(eq(Product.id, newProduct.id));

      // Create unit conversion entries — use provided data if available, otherwise defaults
      if (newProduct && input.unit.length > 0) {
        const conversionsMap = new Map(
          (input.unitConversions ?? []).map((c) => [c.unit_name, c])
        );

        await tx.insert(ProductUnitConversion).values(
          input.unit.map((unit, index) => {
            const provided = conversionsMap.get(unit);
            return {
              product_id: newProduct.id,
              tenant_id: ctx.tenantId!,
              unit_name: unit,
              conversion_factor: provided?.conversion_factor ?? 1,
              is_base_unit: provided?.is_base_unit ?? (index === 0),
              is_purchasable: provided?.is_purchasable ?? true,
            };
          })
        );
      }

      return {
        message: "Product created",
        productId: newProduct?.id,
        versionId: newVersion?.id,
      };
    });
  });
