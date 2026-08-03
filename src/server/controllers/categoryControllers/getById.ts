import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { eq, and } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

export const getByIdCategoryProcedure = authedProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const category = await ctx.db.query.Category.findFirst({
      where: and(eq(Category.id, input.id), eq(Category.tenant_id, ctx.tenantId!)),
    })

    if (!category)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Category not found.",
      })

    return category
  })
