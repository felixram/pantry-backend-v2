import { TRPCError } from "@trpc/server"
import { adminMutation } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { and, eq, isNotNull } from "drizzle-orm"
import { z } from "zod"
import { ROLES, STATUS } from "../../../types/user.ts"

export const reactivateUserProcedure = adminMutation
  .input(z.object({ userId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Was unscoped by tenant — any elevated user in any tenant could
    // reactivate any other tenant's deleted user by id.
    const [deletedUser] = await ctx.db
      .select()
      .from(User)
      .where(and(eq(User.id, input.userId), eq(User.tenant_id, ctx.tenantId)))

    if (!deletedUser) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      })
    }

    // MANAGER can only reactivate users in their location
    if (ctx.user!.role === ROLES.manager && deletedUser.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only manage users in your location",
      })
    }

    if (!deletedUser.deletedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User is already active",
      })
    }

    // Reactivate the user (restore deletedAt and set status to ACTIVE)
    const [reactivatedUser] = await ctx.db
      .update(User)
      .set({
        deletedAt: null,
        status: STATUS.active,
        updatedAt: new Date(),
      })
      .where(and(eq(User.id, input.userId), eq(User.tenant_id, ctx.tenantId)))
      .returning()

    return {
      message: "User has been reactivated",
      user: {
        id: reactivatedUser!.id,
        name: reactivatedUser!.name,
        email: reactivatedUser!.email,
        status: reactivatedUser!.status,
      },
    }
  })
