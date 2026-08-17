import { and, eq, isNull } from "drizzle-orm"
import { Supplier } from "../../../db/schema/supplier.ts"
import { SupplierAudit } from "../../../db/schema/supplierAudit.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const deleteSupplierProcedure = adminMutation
  .input(
    z.object({
      id: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Tenant-scoped existence check — also makes this idempotent-safe:
    // deleting an already-deleted (or another tenant's) supplier now 404s
    // instead of silently "succeeding" again.
    const existingSupplier = await ctx.db.query.Supplier.findFirst({
      where: and(eq(Supplier.id, input.id), eq(Supplier.tenant_id, ctx.tenantId), isNull(Supplier.deletedAt)),
      columns: { id: true, name: true },
    })

    if (!existingSupplier) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Supplier not found.",
      })
    }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(Supplier)
        .set({ deletedAt: new Date() })
        .where(and(eq(Supplier.id, input.id), eq(Supplier.tenant_id, ctx.tenantId!)))
      await tx.insert(SupplierAudit).values({
        supplierId: input.id,
        supplierName: existingSupplier.name,
        tenant_id: ctx.tenantId!,
        action: "deleted",
        userId: ctx.user!.id,
      })
    })

    return { message: "Supplier successfully deleted" }
  })
