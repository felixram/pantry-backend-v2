import { ilike, or, sql, and, isNull, eq } from "drizzle-orm"
import { User } from "../../../db/schema/users.ts"
import { Location } from "../../../db/schema/location.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { ROLES, STATUS } from "../../../types/user.ts"

export const getAllUsersProcedure = authedProcedure
  .input(
    z.object({
      search: z.string().optional(),
      role: z.string().optional(),
      status: z.string().optional(),
      location_id: z.string().optional(),
      includeDeleted: z.boolean().default(false).optional(),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // MANAGER and USER can only see users at their own location; ADMIN can
    // pass an arbitrary filter (or none) to see the whole tenant.
    const effectiveLocationId =
      ctx.user!.role === ROLES.manager || ctx.user!.role === ROLES.user
        ? ctx.userLocationId
        : input.location_id

    // Handle location filter - special case for "unassigned"
    const locationFilter =
      effectiveLocationId === "unassigned"
        ? isNull(User.location_id)
        : effectiveLocationId
          ? eq(User.location_id, effectiveLocationId)
          : sql`TRUE`

    const results = await ctx.db
      .select({
        id: User.id,
        name: User.name,
        lastName: User.last_name,
        email: User.email,
        role: User.role,
        status: User.status,
        location_id: User.location_id,
        location_name: Location.name,
        createdAt: User.createdAt,
        updatedAt: User.updatedAt,
        deletedAt: User.deletedAt,
        totalCount: sql<number>`COUNT(*) OVER()`.as("total_count"),
      })
      .from(User)
      .leftJoin(Location, eq(User.location_id, Location.id))
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
      // Inactive accounts always sort last, regardless of the current
      // search/role/location filters — active-first is the default reading
      // order for a team list, inactive is reference material.
      .orderBy(sql`CASE WHEN ${User.status} = ${STATUS.inactive} THEN 1 ELSE 0 END`, User.name)
      .limit(input.limit)
      .offset(input.offset)

    return {
      results: results.map(({ totalCount, ...user }) => user),
      pagination: {
        total: results[0]?.totalCount ?? 0,
        limit: input.limit,
        offset: input.offset,
        page: Math.floor(input.offset / input.limit) + 1,
        totalPages: Math.ceil((results[0]?.totalCount ?? 0) / input.limit),
      },
    }
  })
