import { clerkClient } from "@clerk/express"
import { adminProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

function invitationLocationId(publicMetadata: unknown): string | null {
  const locationId = (publicMetadata as Record<string, unknown> | undefined)?.location_id
  return typeof locationId === "string" ? locationId : null
}

// Clerk only carries a coarse admin/member role (see toClerkOrgRole in
// types/user.ts) — the real ADMIN/MANAGER/USER role travels in
// publicMetadata instead, same as location_id above. Falls back to the
// coarse Clerk role for any invitation created before this field existed.
function invitationAppRole(inv: { role: string; publicMetadata: unknown }): string {
  const metaRole = (inv.publicMetadata as Record<string, unknown> | undefined)?.app_role
  if (typeof metaRole === "string") return metaRole
  return inv.role === "org:admin" ? ROLES.admin : ROLES.user
}

/**
 * Pending invitations live entirely in Clerk (no local "pending user" row
 * exists until acceptance) — this is the only way the Users page can show
 * them at all.
 *
 * MANAGER can only invite USER role to their own location (see invite.ts),
 * so mirror that same restriction here — otherwise a manager would see (and
 * via resendInvitation/revokeInvitation, be able to act on) ADMIN/MANAGER
 * invitations or ones for a different location entirely.
 */
export const getPendingInvitationsProcedure = adminProcedure.query(async ({ ctx }) => {
  if (!ctx.clerkOrgId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Tenant context required",
    })
  }

  const { data: invitations } = await clerkClient.organizations.getOrganizationInvitationList({
    organizationId: ctx.clerkOrgId,
    status: ["pending"],
  })

  const visible =
    ctx.user!.role === ROLES.manager
      ? invitations.filter(
          (inv) => invitationAppRole(inv) === ROLES.user && invitationLocationId(inv.publicMetadata) === ctx.userLocationId
        )
      : invitations

  return visible.map((inv) => ({
    id: inv.id,
    email: inv.emailAddress,
    role: invitationAppRole(inv),
    createdAt: new Date(inv.createdAt),
  }))
})
