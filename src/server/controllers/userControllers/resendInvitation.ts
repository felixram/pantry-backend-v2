import z from "zod"
import crypto from "crypto"
import { adminMutation } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { TRPCError } from "@trpc/server"
import { and, eq } from "drizzle-orm"
import { ROLES, STATUS } from "../../../types/user.ts"
import { sendInvitationEmail } from "../../../services/email/index.ts"

/**
 * Admin-only procedure to resend an invitation to a pending user
 * Generates a new invitation token and extends the expiration time
 */
export const resendInvitationProcedure = adminMutation
  .input(
    z.object({
      userId: z.string().uuid("Invalid user ID"),
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

    // Find the user - must be in the same tenant and have PENDING status
    const [user] = await ctx.db
      .select()
      .from(User)
      .where(
        and(
          eq(User.id, input.userId),
          eq(User.tenant_id, ctx.tenantId),
          eq(User.status, STATUS.pending)
        )
      )

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found or not in pending status.",
      })
    }

    // MANAGER can only resend invitations for users in their location
    if (ctx.user!.role === ROLES.manager && user.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only manage users in your location",
      })
    }

    // Generate new invitation token
    const invitationToken = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours

    // Update user with new token
    await ctx.db
      .update(User)
      .set({
        invitation_token: invitationToken,
        invitation_expires_at: expiresAt,
      })
      .where(eq(User.id, user.id))

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
      to: user.email,
      userName: user.name,
      inviteUrl,
      organizationName: tenant?.name || "Your Organization",
      expiresAt,
    })

    return {
      status: "success",
      message: emailResult.success
        ? "Invitation resent successfully via email."
        : "Invitation created. Email delivery failed - share the link manually.",
      inviteUrl, // Keep for fallback display
      expiresAt,
      emailSent: emailResult.success,
    }
  })
