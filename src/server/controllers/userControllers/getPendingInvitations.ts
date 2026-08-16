import { clerkClient } from "@clerk/express"
import { adminProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

const ORG_ROLE_TO_ROLE: Record<string, string> = {
  "org:admin": ROLES.admin,
  "org:manager": ROLES.manager,
  "org:member": ROLES.user,
}

function invitationLocationId(publicMetadata: unknown): string | null {
  const locationId = (publicMetadata as Record<string, unknown> | undefined)?.location_id
  return typeof locationId === "string" ? locationId : null
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
          (inv) => inv.role === "org:member" && invitationLocationId(inv.publicMetadata) === ctx.userLocationId
        )
      : invitations

  return visible.map((inv) => ({
    id: inv.id,
    email: inv.emailAddress,
    role: ORG_ROLE_TO_ROLE[inv.role] ?? inv.role,
    createdAt: new Date(inv.createdAt),
  }))
})
