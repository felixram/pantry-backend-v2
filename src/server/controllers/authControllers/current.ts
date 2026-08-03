import { TRPCError } from "@trpc/server"
import { t } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { eq } from "drizzle-orm"
import { isLocationScoped } from "../../../types/user.ts"

export const currentProcedure = t.procedure.query(async ({ ctx }) => {
  if (!ctx.user)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please login." })

  // Fetch full user from database to include all fields (name, email, location, etc)
  const [fullUser] = await ctx.db
    .select({
      id: User.id,
      name: User.name,
      last_name: User.last_name,
      email: User.email,
      role: User.role,
      status: User.status,
      location_id: User.location_id,
      tenantName: Tenant.name,
    })
    .from(User)
    .innerJoin(Tenant, eq(User.tenant_id, Tenant.id))
    .where(eq(User.id, ctx.user.id))

  if (!fullUser || fullUser.status === "inactive" || fullUser.id === null)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found." })

  // Validate that location-scoped users (USER, MANAGER) have a location assigned
  if (isLocationScoped(fullUser.role) && !fullUser.location_id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User location not assigned. Contact administrator.",
    })
  }

  return {
    ...fullUser,
    isDemoTenant: ctx.isDemoTenant,
  }
})
