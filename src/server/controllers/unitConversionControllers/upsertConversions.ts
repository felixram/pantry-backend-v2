import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { syncProductUnits } from "../productControllers/helpers/syncProductUnits.ts"

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
      await syncProductUnits(tx, {
        productId: input.product_id,
        tenantId: ctx.tenantId!,
        conversions: input.conversions,
      })

      return {
        message: "Unit conversions updated",
        count: input.conversions.length,
      }
    })
  })
