import z from "zod"
import { clerkClient } from "@clerk/express"
import { authedMutation } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { Location } from "../../../db/schema/location.ts"
import { TRPCError } from "@trpc/server"
import { and, eq, isNull } from "drizzle-orm"
import { ROLES, hasElevatedRole, isLocationScoped } from "../../../types/user.ts"

const ROLE_TO_ORG_ROLE: Record<string, string> = {
  [ROLES.admin]: "org:admin",
  [ROLES.manager]: "org:manager",
  [ROLES.user]: "org:member",
}

/**
 * Elevated-role procedure to invite a new user to the organization via a
 * Clerk org invitation — Clerk sends the invite email and owns account
 * creation/credentials from here on. ADMIN can invite any role to any
 * location; MANAGER can only invite USER role to their own location.
 *
 * location_id can't travel with the Clerk invitation (Clerk has no concept
 * of it): the local User row is created by the
 * organizationMembership.created webhook on acceptance with location_id
 * left null, and an admin assigns it afterward via adminUpdate.
 */
export const inviteUserProcedure = authedMutation
  .input(
    z.object({
      email: z.string().email("Invalid email format"),
      role: z.enum([ROLES.admin, ROLES.manager, ROLES.user]),
      location_id: z.string().uuid().nullable().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tenantId || !ctx.clerkOrgId || !ctx.clerkUserId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    if (!hasElevatedRole(ctx.user!.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You don't have permission to invite users",
      })
    }

    if (ctx.user!.role === ROLES.manager) {
      if (input.role !== ROLES.user) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers can only invite users with the User role",
        })
      }
      if (!ctx.userLocationId || input.location_id !== ctx.userLocationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers can only invite users to their assigned location",
        })
      }
    }

    const [existingUser] = await ctx.db
      .select()
      .from(User)
      .where(
        and(eq(User.email, input.email), eq(User.tenant_id, ctx.tenantId), isNull(User.deletedAt))
      )

    if (existingUser) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A user with this email already exists in your organization.",
      })
    }

    if (input.location_id) {
      const [location] = await ctx.db
        .select()
        .from(Location)
        .where(
          and(
            eq(Location.id, input.location_id),
            eq(Location.tenant_id, ctx.tenantId),
            isNull(Location.deletedAt)
          )
        )
      if (!location) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Selected location not found or not available.",
        })
      }
    }

    if (isLocationScoped(input.role) && !input.location_id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Users and managers must be assigned to a location.",
      })
    }

    const invitation = await clerkClient.organizations.createOrganizationInvitation({
      organizationId: ctx.clerkOrgId,
      inviterUserId: ctx.clerkUserId,
      emailAddress: input.email,
      role: ROLE_TO_ORG_ROLE[input.role]!,
    })

    return {
      status: "success",
      message: "Invitation sent.",
      invitationId: invitation.id,
    }
  })
