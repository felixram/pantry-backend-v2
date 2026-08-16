import { clerkClient } from "@clerk/express"
import { adminProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

const ORG_ROLE_TO_ROLE: Record<string, string> = {
  "org:admin": ROLES.admin,
  "org:manager": ROLES.manager,
  "org:member": ROLES.user,
}

/**
 * Pending invitations live entirely in Clerk (no local "pending user" row
 * exists until acceptance) — this is the only way the Users page can show
 * them at all.
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

  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.emailAddress,
    role: ORG_ROLE_TO_ROLE[inv.role] ?? inv.role,
    createdAt: new Date(inv.createdAt),
  }))
})
