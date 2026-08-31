import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"
import { adminProcedure } from "../../trpc.ts"
import { Tenant } from "../../../db/schema/tenant.ts"

// Elevated role (ADMIN or MANAGER) may read org settings; only strict ADMIN
// writes them (see updateSettings.ts).
export const getTenantSettingsProcedure = adminProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
  }

  const tenant = await ctx.db.query.Tenant.findFirst({
    where: eq(Tenant.id, ctx.tenantId),
    columns: { name: true, default_currency: true },
  })

  if (!tenant) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" })
  }

  return {
    name: tenant.name,
    default_currency: tenant.default_currency,
  }
})
