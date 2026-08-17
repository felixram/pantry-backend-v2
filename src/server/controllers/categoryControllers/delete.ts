import z from "zod"
import { and, eq, isNull } from "drizzle-orm"
import { Category } from "../../../db/schema/category.ts"
import { CategoryAudit } from "../../../db/schema/categoryAudit.ts"
import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"

export const deleteCategoryProcedure = adminMutation
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
    // deleting an already-deleted (or another tenant's) category now 404s
    // instead of silently "succeeding" again.
    const existingCategory = await ctx.db.query.Category.findFirst({
      where: and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId), isNull(Category.deletedAt)),
      columns: { id: true, name: true },
    })

    if (!existingCategory) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Category not found.",
      })
    }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(Category)
        .set({ deletedAt: new Date() })
        .where(and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId!)))
      await tx.insert(CategoryAudit).values({
        categoryId: input.id,
        categoryName: existingCategory.name,
        tenant_id: ctx.tenantId!,
        action: "deleted",
        userId: ctx.user!.id,
      })
    })

    return { message: "Category successfully deleted" }
  })
