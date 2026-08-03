import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { and, eq, isNull } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { handleDbError } from "../../../utils/dbErrors.ts"
import { TAX_TYPE } from "../../../types/tax.ts"

export const updateTaxRateProcedure = authedMutation
  .input(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      rate: z.number().min(0).max(100).optional(),
      type: z.enum([TAX_TYPE.purchase, TAX_TYPE.sales, TAX_TYPE.both]).optional(),
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
      const existing = await tx.query.TaxRate.findFirst({
        where: and(
          eq(TaxRate.id, input.id),
          eq(TaxRate.tenant_id, ctx.tenantId!),
          isNull(TaxRate.deletedAt)
        ),
      })

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tax rate not found",
        })
      }

      const updatedData: Record<string, any> = {}
      if (input.name !== undefined) updatedData.name = input.name.trim()
      if (input.rate !== undefined) updatedData.rate = input.rate
      if (input.type !== undefined) updatedData.type = input.type

      if (Object.keys(updatedData).length === 0) {
        return { message: "Nothing to update." }
      }

      try {
        const [taxRate] = await tx
          .update(TaxRate)
          .set(updatedData)
          .where(eq(TaxRate.id, input.id))
          .returning()

        return { message: "Tax rate updated", taxRate }
      } catch (error) {
        throw handleDbError(error, {
          uniqueViolation: "A tax rate with this name already exists.",
        })
      }
    })
  })
