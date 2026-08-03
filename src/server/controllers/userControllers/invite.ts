import z from "zod"
import crypto from "crypto"
import { authedMutation } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { Location } from "../../../db/schema/location.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { TRPCError } from "@trpc/server"
import { and, eq, isNull } from "drizzle-orm"
import { ROLES, STATUS, hasElevatedRole, isLocationScoped } from "../../../types/user.ts"
import { sendInvitationEmail } from "../../../services/email/index.ts"
import { handleDbError } from "../../../utils/dbErrors.ts"

/**
 * Elevated-role procedure to invite a new user to the organization
 * Creates a pending user with an invitation token
 * ADMIN can invite any role to any location
 * MANAGER can only invite USER role to their own location
 */
export const inviteUserProcedure = authedMutation
  .input(
    z.object({
      name: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required"),
      email: z.string().email("Invalid email format"),
      role: z.enum([ROLES.admin, ROLES.manager, ROLES.user]),
      location_id: z.string().uuid().nullable().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    // Ensure we have tenant context
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Only elevated roles can invite users
    if (!hasElevatedRole(ctx.user!.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You don't have permission to invite users",
      })
    }

    // MANAGER restrictions: can only invite USER role to their own location
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

    // Check if email is already in use within this tenant
    const [existingUser] = await ctx.db
      .select()
      .from(User)
      .where(
        and(
          eq(User.email, input.email),
          eq(User.tenant_id, ctx.tenantId),
          isNull(User.deletedAt)
        )
      )

    if (existingUser) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A user with this email already exists in your organization.",
      })
    }

    // MANAGER restrictions: cannot invite admins, must invite to own location
    if (ctx.user!.role === ROLES.manager) {
      if (input.role === ROLES.admin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers cannot invite admin users",
        })
      }
      if (input.location_id && input.location_id !== ctx.userLocationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers can only invite users to their own location",
        })
      }
      // Force invited user to manager's location
      input.location_id = ctx.userLocationId
    }

    // If location_id is provided, verify it exists and belongs to this tenant
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

    // Validate role-location requirements
    // Location-scoped roles (USER, MANAGER) require a location
    if (isLocationScoped(input.role) && !input.location_id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Users and managers must be assigned to a location.",
      })
    }

    // ADMIN role should not have a location
    const finalLocationId = input.role === ROLES.admin ? null : input.location_id

    // Generate secure invitation token
    const invitationToken = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours

    // Create pending user
    let newUser
    try {
      const [inserted] = await ctx.db
        .insert(User)
        .values({
          name: input.name,
          last_name: input.lastName,
          email: input.email,
          password: "", // Will be set when invitation is accepted
          role: input.role,
          status: STATUS.pending,
          tenant_id: ctx.tenantId,
          location_id: finalLocationId,
          invitation_token: invitationToken,
          invitation_expires_at: expiresAt,
        })
        .returning()
      newUser = inserted
    } catch (error) {
      throw handleDbError(error, {
        uniqueViolation: "A user with this email already exists. They may have been previously deactivated.",
      })
    }

    if (!newUser) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create user invitation",
      })
    }

    // Build invitation URL
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
    const inviteUrl = `${clientUrl}/accept-invite?token=${invitationToken}`

    // Fetch tenant name for email
    const [tenant] = await ctx.db
      .select({ name: Tenant.name })
      .from(Tenant)
      .where(eq(Tenant.id, ctx.tenantId))

    // Send invitation email
    const emailResult = await sendInvitationEmail({
      to: input.email,
      userName: input.name,
      inviteUrl,
      organizationName: tenant?.name || "Your Organization",
      expiresAt,
    })

    return {
      status: "success",
      message: emailResult.success
        ? "Invitation sent successfully via email."
        : "Invitation created. Email delivery failed - share the link manually.",
      userId: newUser.id,
      inviteUrl, // Keep for fallback display
      expiresAt,
      emailSent: emailResult.success,
    }
  })
