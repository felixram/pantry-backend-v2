import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { adminMutation } from "../../trpc.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { ROLES } from "../../../types/user.ts"
import { isSupportedCurrency, normalizeCurrency } from "../../../types/currency.ts"

// adminMutation gives the demo-tenant guard + elevated-role floor; the
// strict ADMIN check below narrows it further (org-wide setting, same bar
// as deleteTenant.ts).
export const updateTenantSettingsProcedure = adminMutation
  .input(
    z.object({
      default_currency: z.string().min(1).max(8).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
    }
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can change organization settings.",
      })
    }

    const patch: Partial<typeof Tenant.$inferInsert> = {}

    if (input.default_currency !== undefined) {
      const normalized = normalizeCurrency(input.default_currency)
      if (!normalized || !isSupportedCurrency(normalized)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported currency: ${input.default_currency}`,
        })
      }
      patch.default_currency = normalized
    }

    if (Object.keys(patch).length === 0) {
      return { message: "Nothing to update." }
    }

    const [updated] = await ctx.db
      .update(Tenant)
      .set(patch)
      .where(eq(Tenant.id, ctx.tenantId))
      .returning({ default_currency: Tenant.default_currency })

    return { message: "Organization settings updated", ...updated }
  })
