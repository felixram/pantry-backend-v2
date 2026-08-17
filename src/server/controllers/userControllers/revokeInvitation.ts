import z from "zod"
import { clerkClient } from "@clerk/express"
import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

function invitationLocationId(publicMetadata: unknown): string | null {
  const locationId = (publicMetadata as Record<string, unknown> | undefined)?.location_id
  return typeof locationId === "string" ? locationId : null
}

// Clerk only carries a coarse admin/member role (see toClerkOrgRole in
// types/user.ts) — the real ADMIN/MANAGER/USER role travels in
// publicMetadata instead, same as location_id above.
function invitationAppRole(publicMetadata: unknown): string | null {
  const role = (publicMetadata as Record<string, unknown> | undefined)?.app_role
  return typeof role === "string" ? role : null
}

/**
 * Cancel a pending Clerk org invitation (typo'd email, changed mind, etc).
 * No local row to clean up — pending invites only ever live in Clerk.
 *
 * MANAGER can only invite (and therefore only revoke) USER-role invitations
 * at their own location, same restriction as invite.ts — this endpoint is
 * only nominally "admin"-gated (adminMutation really means "elevated role",
 * i.e. ADMIN or MANAGER), so the manager-specific check has to happen here.
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

    if (ctx.user!.role === ROLES.manager) {
      const { data: invitations } = await clerkClient.organizations.getOrganizationInvitationList({
        organizationId: ctx.clerkOrgId,
        status: ["pending"],
      })
      const target = invitations.find((inv) => inv.id === input.id)

      if (
        !target ||
        invitationAppRole(target.publicMetadata) !== ROLES.user ||
        invitationLocationId(target.publicMetadata) !== ctx.userLocationId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only manage invitations for users at your own location",
        })
      }
    }

    await clerkClient.organizations.revokeOrganizationInvitation({
      organizationId: ctx.clerkOrgId,
      invitationId: input.id,
      requestingUserId: ctx.clerkUserId,
    })

    return { status: "success", message: "Invitation revoked." }
  })
