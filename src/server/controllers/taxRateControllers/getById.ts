import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { and, eq, isNull } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const getTaxRateByIdProcedure = authedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const taxRate = await ctx.db.query.TaxRate.findFirst({
      where: and(
        eq(TaxRate.id, input.id),
        eq(TaxRate.tenant_id, ctx.tenantId),
        isNull(TaxRate.deletedAt)
      ),
    })

    if (!taxRate) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Tax rate not found",
      })
    }

    return taxRate
  })
