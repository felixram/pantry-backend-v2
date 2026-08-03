import z from "zod"
import { authedMutation, t } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { eq } from "drizzle-orm"

export const deleteCategoryProcedure = authedMutation
  .input(
    z.object({
      id: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    await ctx.db.delete(Category).where(eq(Category.id, input.id))

    return { message: "Category Deleted." }
  })
