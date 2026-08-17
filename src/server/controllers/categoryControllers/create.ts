import z from "zod"
import { adminMutation, t } from "../../trpc.ts"
import { Category } from "../../../db/schema/category.ts"
import { TRPCError } from "@trpc/server"
import { handleDbError } from "../../../utils/dbErrors.ts"

// adminMutation (elevated role) — categories are shared reference data;
// mutating them moved out of authedMutation so USER can no longer
// create/edit/delete/restore them, only browse (getAll/getById stay open).
export const createCategoryProcedure = adminMutation
  .input(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      tax_rate_id: z.string().uuid().nullable().optional(),
      is_tax_exempt: z.boolean().optional().default(false),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const { name, description, tax_rate_id, is_tax_exempt } = input

    try {
      await ctx.db.insert(Category).values({
        name: name.trim(),
        description: description?.trim() || null,
        tax_rate_id: tax_rate_id ?? null,
        is_tax_exempt,
        tenant_id: ctx.tenantId,
      })

      return { message: "Category successfully created!" }
    } catch (error) {
      throw handleDbError(error, {
        uniqueViolation: "This Category already exists.",
      })
    }
  })
