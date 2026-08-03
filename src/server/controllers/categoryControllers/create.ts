import z from "zod"
import { authedMutation, t } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { TRPCError } from "@trpc/server"
import { handleDbError } from "../../../utils/dbErrors.ts"

export const createCategoryProcedure = authedMutation
  .input(
    z.object({
      name: z.string(),
      description: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const { name, description } = input

    try {
      await ctx.db.insert(Category).values({
        name: (
          name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
        ).trim(),
        description: description?.trim() || null,
        tenant_id: ctx.tenantId,
      })

      return { message: "Category successfully created!" }
    } catch (error) {
      throw handleDbError(error, {
        uniqueViolation: "This Category already exists.",
      })
    }
  })
