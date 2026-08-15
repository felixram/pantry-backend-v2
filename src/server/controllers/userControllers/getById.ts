import { TRPCError } from "@trpc/server"
import { User } from "../../../db/schema/users.ts"
import { adminProcedure } from "../../trpc.ts"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { ROLES } from "../../../types/user.ts"

export const getUserByIdProcedure = adminProcedure
  .input(
    z.object({
      id: z.string().uuid("Invalid user ID"),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Was unscoped by tenant — any elevated user in any tenant could look up
    // any other tenant's user by id.
    const user = await ctx.db.query.User.findFirst({
      where: and(eq(User.id, input.id), eq(User.tenant_id, ctx.tenantId)),
    })

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      })
    }

    // MANAGER can only view users in their location
    if (ctx.user!.role === ROLES.manager && user.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only view users in your location",
      })
    }

    return {
      id: user.id,
      name: user.name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  })
