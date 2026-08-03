import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts"
import { Product } from "../../../db/schema/product.ts"
import { eq, and } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const upsertConversionsProcedure = authedMutation
  .input(
    z.object({
      product_id: z.string().uuid(),
      conversions: z
        .array(
          z.object({
            unit_name: z.string().min(1),
            conversion_factor: z.number().positive(),
            is_base_unit: z.boolean(),
            is_purchasable: z.boolean().optional().default(true),
          })
        )
        .min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Validate: exactly one base unit
    const baseUnits = input.conversions.filter((c) => c.is_base_unit)
    if (baseUnits.length !== 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Exactly one conversion must be marked as the base unit.",
      })
    }

    // Validate: base unit must have conversion_factor = 1
    if (baseUnits[0]!.conversion_factor !== 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The base unit must have a conversion factor of 1.",
      })
    }

    // Validate: no duplicate unit names
    const unitNames = input.conversions.map((c) => c.unit_name)
    const uniqueNames = new Set(unitNames)
    if (uniqueNames.size !== unitNames.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Duplicate unit names are not allowed.",
      })
    }

    return await ctx.db.transaction(async (tx) => {
      // Delete all existing conversions for this product and tenant
      await tx
        .delete(ProductUnitConversion)
        .where(
          and(
            eq(ProductUnitConversion.product_id, input.product_id),
            eq(ProductUnitConversion.tenant_id, ctx.tenantId!)
          )
        )

      // Insert all new conversions
      await tx.insert(ProductUnitConversion).values(
        input.conversions.map((c) => ({
          product_id: input.product_id,
          tenant_id: ctx.tenantId!,
          unit_name: c.unit_name,
          conversion_factor: c.conversion_factor,
          is_base_unit: c.is_base_unit,
          is_purchasable: c.is_purchasable,
        }))
      )

      // Sync the Product's unit array
      await tx
        .update(Product)
        .set({ unit: unitNames })
        .where(eq(Product.id, input.product_id))

      return {
        message: "Unit conversions updated",
        count: input.conversions.length,
      }
    })
  })
