import z from "zod"
import { authedMutation, t } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const updateCategoryProcedure = authedMutation
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
    const existingCategory = await ctx.db.query.Category.findFirst({
      where: eq(Category.id, input.id),
    })

    if (!existingCategory)
      throw new TRPCError({ code: "NOT_FOUND", message: "Category not found." })

    const newCategory: Record<string, any> = {}
    if (input.name) newCategory.name = input.name.trim()
    if (input.description) newCategory.description = input.description.trim()
    if (input.tax_rate_id !== undefined) newCategory.tax_rate_id = input.tax_rate_id
    if (input.is_tax_exempt !== undefined) newCategory.is_tax_exempt = input.is_tax_exempt

    if (Object.keys(newCategory).length === 0)
      return { message: "Nothing to update." }

    const updatedCategory = await ctx.db
      .update(Category)
      .set(newCategory)
      .where(eq(Category.id, input.id))
      .returning()

    return { message: "Category updated!", category: updatedCategory }
  })
