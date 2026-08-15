import z from "zod"
import { adminMutation } from "../../trpc.ts"
import { TaxRate } from "../../../db/schema/taxRate.ts"
import { TaxRateAudit } from "../../../db/schema/taxRateAudit.ts"
import { and, eq, isNull } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const deleteTaxRateProcedure = adminMutation
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Tenant-scoped existence check — also makes this idempotent-safe:
    // deleting an already-deleted (or another tenant's) rate now 404s
    // instead of silently "succeeding" again.
    const existing = await ctx.db.query.TaxRate.findFirst({
      where: and(
        eq(TaxRate.id, input.id),
        eq(TaxRate.tenant_id, ctx.tenantId),
        isNull(TaxRate.deletedAt)
      ),
      columns: { id: true, name: true },
    })

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Tax rate not found",
      })
    }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(TaxRate)
        .set({ deletedAt: new Date() })
        .where(and(eq(TaxRate.id, input.id), eq(TaxRate.tenant_id, ctx.tenantId!)))
      await tx.insert(TaxRateAudit).values({
        taxRateId: input.id,
        taxRateName: existing.name,
        tenant_id: ctx.tenantId!,
        action: "deleted",
        userId: ctx.user!.id,
      })
    })

    return { message: "Tax rate deleted" }
  })
