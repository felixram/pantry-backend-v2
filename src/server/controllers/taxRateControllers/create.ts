import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"
import { handleDbError } from "../../../utils/dbErrors.ts"
import { TAX_TYPE } from "../../../types/tax.ts"

export const createTaxRateProcedure = authedMutation
  .input(
    z.object({
      name: z.string().min(1),
      rate: z.number().min(0).max(100),
      type: z.enum([TAX_TYPE.purchase, TAX_TYPE.sales, TAX_TYPE.both]),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    try {
      const [taxRate] = await ctx.db
        .insert(TaxRate)
        .values({
          tenant_id: ctx.tenantId!,
          name: input.name.trim(),
          rate: input.rate,
          type: input.type,
        })
        .returning()

      return { message: "Tax rate created", taxRate }
    } catch (error) {
      throw handleDbError(error, {
        uniqueViolation: "A tax rate with this name already exists.",
      })
    }
  })
