import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { ProductUnitConversion } from "../../../db/schema/productUnitConversion.ts"
import { eq, and, desc, asc } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const getByProductProcedure = authedProcedure
  .input(
    z.object({
      product_id: z.string().uuid(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const conversions = await ctx.db
      .select()
      .from(ProductUnitConversion)
      .where(
        and(
          eq(ProductUnitConversion.product_id, input.product_id),
          eq(ProductUnitConversion.tenant_id, ctx.tenantId)
        )
      )
      .orderBy(
        desc(ProductUnitConversion.is_base_unit),
        asc(ProductUnitConversion.unit_name)
      )

    return conversions
  })
