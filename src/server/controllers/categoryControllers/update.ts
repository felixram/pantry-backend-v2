import z from "zod"
import { adminMutation, t } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { and, eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const updateCategoryProcedure = adminMutation
  .input(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      tax_rate_id: z.string().uuid().nullable().optional(),
      is_tax_exempt: z.boolean().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const existingCategory = await ctx.db.query.Category.findFirst({
      where: and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId)),
    })

    if (!existingCategory)
      throw new TRPCError({ code: "NOT_FOUND", message: "Category not found." })

    const newCategory: Record<string, any> = {}
    if (input.name !== undefined) newCategory.name = input.name.trim()
    if (input.description !== undefined) newCategory.description = input.description.trim()
    if (input.tax_rate_id !== undefined) newCategory.tax_rate_id = input.tax_rate_id
    if (input.is_tax_exempt !== undefined) newCategory.is_tax_exempt = input.is_tax_exempt

    if (Object.keys(newCategory).length === 0)
      return { message: "Nothing to update." }

    const updatedCategory = await ctx.db
      .update(Category)
      .set(newCategory)
      .where(and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId)))
      .returning()

    return { message: "Category updated!", category: updatedCategory }
  })
