import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts"
import { Product } from "../../../db/schema/product.ts"
import { eq, and } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

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

    // Find the conversion and verify it belongs to this tenant
    const conversion = await ctx.db
      .select()
      .from(ProductUnitConversion)
      .where(
        and(
          eq(ProductUnitConversion.id, input.id),
          eq(ProductUnitConversion.tenant_id, ctx.tenantId)
        )
      )

    if (!conversion[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Unit conversion not found.",
      })
    }

    const target = conversion[0]

    // Cannot delete a base unit if other conversions exist for that product
    if (target.is_base_unit) {
      const otherConversions = await ctx.db
        .select()
        .from(ProductUnitConversion)
        .where(
          and(
            eq(ProductUnitConversion.product_id, target.product_id),
            eq(ProductUnitConversion.tenant_id, ctx.tenantId)
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

    // Delete the conversion
    await ctx.db
      .delete(ProductUnitConversion)
      .where(eq(ProductUnitConversion.id, input.id))

    // Remove the unit_name from the Product's unit array
    const product = await ctx.db.query.Product.findFirst({
      where: eq(Product.id, target.product_id),
    })

    if (product) {
      const updatedUnits = product.unit.filter((u) => u !== target.unit_name)
      await ctx.db
        .update(Product)
        .set({ unit: updatedUnits })
        .where(eq(Product.id, target.product_id))
    }

    return { message: "Unit conversion deleted" }
  })
