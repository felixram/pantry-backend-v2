import z from "zod"
import { clerkClient } from "@clerk/express"
import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"

/**
 * Admin-only: cancel a pending Clerk org invitation (typo'd email, changed
 * mind, etc). No local row to clean up — pending invites only ever live in
 * Clerk.
 */
export const revokeInvitationProcedure = adminMutation
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.clerkOrgId || !ctx.clerkUserId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    await clerkClient.organizations.revokeOrganizationInvitation({
      organizationId: ctx.clerkOrgId,
      invitationId: input.id,
      requestingUserId: ctx.clerkUserId,
    })

    return { status: "success", message: "Invitation revoked." }
  })
