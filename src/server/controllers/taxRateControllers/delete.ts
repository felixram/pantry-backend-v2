import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { and, eq, isNull } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const deleteTaxRateProcedure = authedMutation
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const existing = await ctx.db.query.TaxRate.findFirst({
      where: and(
        eq(TaxRate.id, input.id),
        eq(TaxRate.tenant_id, ctx.tenantId),
        isNull(TaxRate.deletedAt)
      ),
    })

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Tax rate not found",
      })
    }

    await ctx.db
      .update(TaxRate)
      .set({ deletedAt: new Date() })
      .where(eq(TaxRate.id, input.id))

    return { message: "Tax rate deleted" }
  })
