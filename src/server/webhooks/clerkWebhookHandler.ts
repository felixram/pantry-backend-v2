import type { Request, Response } from "express"
import { verifyWebhook } from "@clerk/express/webhooks"
import { clerkClient } from "@clerk/express"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../db/index.ts"
import { User } from "../../db/schema/users.ts"
import { Tenant } from "../../db/schema/tenant.ts"
import { ROLES, STATUS } from "../../types/user.ts"
import { logger } from "../../utils/logger.ts"

const ORG_ROLE_TO_ROLE: Record<string, string> = {
  "org:admin": ROLES.admin,
  "org:manager": ROLES.manager,
  "org:member": ROLES.user,
}

/**
 * Recovers the location_id an invite.ts caller attached to the invitation's
 * publicMetadata (Clerk has no native concept of location) — read back here
 * on first join rather than via a second organizationInvitation.accepted
 * webhook subscription, avoiding any event-ordering race between the two.
 */
async function lookupInvitedLocationId(organizationId: string, email: string): Promise<string | null> {
  const { data: invitations } = await clerkClient.organizations.getOrganizationInvitationList({
    organizationId,
    status: ["accepted"],
  })
  const invitation = invitations.find((inv) => inv.emailAddress === email)
  const locationId = (invitation?.publicMetadata as Record<string, unknown> | undefined)?.location_id
  return typeof locationId === "string" ? locationId : null
}

/**
 * Keeps the local User/Tenant "read mirror" (name/last_name/email/role, plus
 * the clerk_user_id/clerk_org_id link columns) in sync with Clerk, which owns
 * identity/credentials/org-membership as the source of truth. See
 * resolveAuthContext.ts for how role is read live from the session claim
 * instead of this mirror on the request path — this handler exists for the
 * columns that DO need a local copy (SQL joins/filters, ctx.user.id staying
 * our own uuid).
 */
export async function handleClerkWebhook(req: Request, res: Response) {
  let evt
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    logger.error({ err }, "Clerk webhook verification failed")
    return res.status(400).send("Error verifying webhook")
  }

  try {
    switch (evt.type) {
      case "organization.created": {
        const { id, name, slug } = evt.data
        await db
          .insert(Tenant)
          .values({ name, slug: slug || id, clerk_org_id: id })
          .onConflictDoNothing({ target: Tenant.clerk_org_id })
        break
      }

      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const { organization, public_user_data, role } = evt.data
        const mappedRole = ORG_ROLE_TO_ROLE[role]
        if (!mappedRole) {
          logger.warn({ role }, "Unmapped Clerk org role on membership event, skipping")
          break
        }

        const [tenant] = await db
          .select({ id: Tenant.id })
          .from(Tenant)
          .where(and(eq(Tenant.clerk_org_id, organization.id), isNull(Tenant.deletedAt)))
        if (!tenant) {
          logger.error({ orgId: organization.id }, "organizationMembership event for unknown tenant")
          break
        }

        const email = public_user_data.identifier ?? ""
        const firstName = public_user_data.first_name ?? ""
        const lastName = public_user_data.last_name ?? ""

        // Link to an existing row by clerk_user_id first (role/name resync).
        const [existingByClerkId] = await db
          .select({ id: User.id })
          .from(User)
          .where(eq(User.clerk_user_id, public_user_data.user_id))

        if (existingByClerkId) {
          await db
            .update(User)
            .set({
              role: mappedRole,
              name: firstName,
              last_name: lastName,
              email,
              status: STATUS.active,
              deletedAt: null,
            })
            .where(eq(User.id, existingByClerkId.id))
          break
        }

        // Not linked yet — fall back to matching a pre-existing (migration-
        // seeded) row by email within this tenant, else create fresh.
        const [existingByEmail] = await db
          .select({ id: User.id })
          .from(User)
          .where(and(eq(User.email, email), eq(User.tenant_id, tenant.id)))

        if (existingByEmail) {
          // Pre-existing (e.g. migration-seeded) row — its location_id is
          // real app data set by an admin, not something to overwrite from
          // the invitation.
          await db
            .update(User)
            .set({
              clerk_user_id: public_user_data.user_id,
              role: mappedRole,
              name: firstName,
              last_name: lastName,
              status: STATUS.active,
              deletedAt: null,
            })
            .where(eq(User.id, existingByEmail.id))
        } else {
          const location_id = await lookupInvitedLocationId(organization.id, email)
          await db.insert(User).values({
            clerk_user_id: public_user_data.user_id,
            tenant_id: tenant.id,
            name: firstName || email,
            last_name: lastName,
            email,
            role: mappedRole,
            status: STATUS.active,
            location_id,
          })
        }
        break
      }

      case "organizationMembership.deleted": {
        const { public_user_data } = evt.data
        await db
          .update(User)
          .set({ deletedAt: new Date(), status: STATUS.inactive })
          .where(eq(User.clerk_user_id, public_user_data.user_id))
        break
      }

      case "user.updated": {
        const { id, first_name, last_name, email_addresses } = evt.data
        const email = email_addresses[0]?.email_address
        await db
          .update(User)
          .set({
            name: first_name ?? "",
            last_name: last_name ?? "",
            ...(email ? { email } : {}),
          })
          .where(eq(User.clerk_user_id, id))
        break
      }

      default:
        break
    }
  } catch (err) {
    logger.error({ err, eventType: evt.type }, "Clerk webhook handler failed")
    return res.status(500).send("Handler error")
  }

  return res.status(200).send("OK")
}
