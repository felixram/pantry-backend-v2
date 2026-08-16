import z from "zod"
import { clerkClient } from "@clerk/express"
import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"

/**
 * Admin-only: revoke and recreate a pending Clerk org invitation for an
 * email, which resends the invite email. There's no local "pending user"
 * row anymore — a pending invite lives entirely in Clerk until accepted,
 * at which point the organizationMembership.created webhook creates the
 * local User row.
 */
export const resendInvitationProcedure = adminMutation
  .input(z.object({ email: z.string().email("Invalid email format") }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tenantId || !ctx.clerkOrgId || !ctx.clerkUserId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const { data: invitations } = await clerkClient.organizations.getOrganizationInvitationList({
      organizationId: ctx.clerkOrgId,
      status: ["pending"],
    })
    const existing = invitations.find((inv) => inv.emailAddress === input.email)

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No pending invitation found for this email.",
      })
    }

    await clerkClient.organizations.revokeOrganizationInvitation({
      organizationId: ctx.clerkOrgId,
      invitationId: existing.id,
      requestingUserId: ctx.clerkUserId,
    })

    const invitation = await clerkClient.organizations.createOrganizationInvitation({
      organizationId: ctx.clerkOrgId,
      inviterUserId: ctx.clerkUserId,
      emailAddress: input.email,
      role: existing.role,
    })

    return {
      status: "success",
      message: "Invitation resent.",
      invitationId: invitation.id,
    }
  })
