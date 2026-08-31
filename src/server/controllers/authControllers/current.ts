import { TRPCError } from "@trpc/server"
import { t } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { eq } from "drizzle-orm"
import { isLocationScoped } from "../../../types/user.ts"

// Auth itself (Clerk session or magic-link cookie -> local row) is already
// resolved upstream in context.ts / resolveAuthContext.ts; this just fetches
// the app-specific display fields the frontend's useAuth() hook expects.
export const currentProcedure = t.procedure.query(async ({ ctx }) => {
  if (!ctx.user)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please login." })

  const [fullUser] = await ctx.db
    .select({
      id: User.id,
      name: User.name,
      last_name: User.last_name,
      email: User.email,
      status: User.status,
      location_id: User.location_id,
      tenantName: Tenant.name,
      default_currency: Tenant.default_currency,
    })
    .from(User)
    .innerJoin(Tenant, eq(User.tenant_id, Tenant.id))
    .where(eq(User.id, ctx.user.id))

  if (!fullUser)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found." })

  // role comes from ctx.user, not this row — see resolveAuthContext.ts for
  // why (sourced live from the Clerk session claim, never webhook-sync-stale).
  const role = ctx.user.role

  if (isLocationScoped(role) && !fullUser.location_id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User location not assigned. Contact administrator.",
    })
  }

  return {
    ...fullUser,
    role,
    isDemoTenant: ctx.isDemoTenant,
  }
})
