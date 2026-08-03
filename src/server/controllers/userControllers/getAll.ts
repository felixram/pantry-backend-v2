import { ilike, or, sql, and, isNull, eq } from "drizzle-orm"
import { User } from "../../../db/schema/users.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

export const getAllUsersProcedure = authedProcedure
  .input(
    z.object({
      search: z.string().optional(),
      role: z.string().optional(),
      status: z.string().optional(),
      location_id: z.string().optional(),
      includeDeleted: z.boolean().default(false).optional(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // MANAGER can only see users at their location
    const effectiveLocationId =
      ctx.user!.role === ROLES.manager
        ? ctx.userLocationId
        : input.location_id

    // Handle location filter - special case for "unassigned"
    const locationFilter =
      effectiveLocationId === "unassigned"
        ? isNull(User.location_id)
        : effectiveLocationId
          ? eq(User.location_id, effectiveLocationId)
          : sql`TRUE`

    const users = await ctx.db
      .select()
      .from(User)
      .where(
        and(
          eq(User.tenant_id, ctx.tenantId),
          input.search
            ? or(
                ilike(User.name, `%${input.search}%`),
                ilike(User.last_name, `%${input.search}%`),
                ilike(User.email, `%${input.search}%`)
              )
            : sql`TRUE`,
          input.role ? eq(User.role, input.role) : sql`TRUE`,
          input.status ? eq(User.status, input.status) : sql`TRUE`,
          locationFilter,
          input.includeDeleted ? sql`TRUE` : isNull(User.deletedAt)
        )
      )

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      status: user.status,
      location_id: user.location_id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    }))
  })
