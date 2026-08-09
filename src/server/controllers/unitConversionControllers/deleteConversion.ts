import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts"
import { eq, and, ne } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { syncProductUnits } from "../productControllers/helpers/syncProductUnits.ts"

export const deleteConversionProcedure = authedMutation
  .input(
    z.object({
      id: z.string().uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    return await ctx.db.transaction(async (tx) => {
      // Find the conversion and verify it belongs to this tenant
      const conversion = await tx
        .select()
        .from(ProductUnitConversion)
        .where(
          and(
            eq(ProductUnitConversion.id, input.id),
            eq(ProductUnitConversion.tenant_id, ctx.tenantId!)
          )
        )

      const target = conversion[0]
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Unit conversion not found.",
        })
      }

      // Cannot delete a base unit if other conversions exist for that product
      if (target.is_base_unit) {
        const otherConversions = await tx
          .select()
          .from(ProductUnitConversion)
          .where(
            and(
              eq(ProductUnitConversion.product_id, target.product_id),
              eq(ProductUnitConversion.tenant_id, ctx.tenantId!)
            )
          )

        if (otherConversions.length > 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot delete the base unit while other conversions exist for this product.",
          })
        }
      }

      // Everything else in this product's unit list survives unchanged —
      // fetch it and pass it straight to syncProductUnits, which deletes
      // the target as part of replacing the full set and re-derives
      // Product.unit in the same transaction (previously the delete and
      // the Product.unit update were separate, unguarded statements).
      const remaining = await tx
        .select()
        .from(ProductUnitConversion)
        .where(
          and(
            eq(ProductUnitConversion.product_id, target.product_id),
            eq(ProductUnitConversion.tenant_id, ctx.tenantId!),
            ne(ProductUnitConversion.id, target.id)
          )
        )

      await syncProductUnits(tx, {
        productId: target.product_id,
        tenantId: ctx.tenantId!,
        conversions: remaining.map((c) => ({
          unit_name: c.unit_name,
          conversion_factor: c.conversion_factor,
          is_base_unit: c.is_base_unit,
          is_purchasable: c.is_purchasable,
        })),
      })

      return { message: "Unit conversion deleted" }
    })
  })
