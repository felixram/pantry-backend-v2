import type { Request, Response } from "express"
import { verifyWebhook } from "@clerk/express/webhooks"
import { clerkClient } from "@clerk/express"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../db/index.ts"
import { User } from "../../db/schema/users.ts"
import { Tenant } from "../../db/schema/tenant.ts"
import { ROLES, STATUS } from "../../types/user.ts"
import { logger } from "../../utils/logger.ts"

/**
 * Recovers the location_id and app_role an invite.ts caller attached to the
 * invitation's publicMetadata (Clerk has no native concept of location, and
 * only a coarse admin/member role — see toClerkOrgRole in types/user.ts) —
 * read back here on first join rather than via a second
 * organizationInvitation.accepted webhook subscription, avoiding any
 * event-ordering race between the two.
 *
 * Falls back to deriving appRole from the event's own coarse Clerk role when
 * no matching invitation is found — covers seedDemo.ts/reactivate.ts, which
 * create memberships directly via createOrganizationMembership rather than
 * an invitation; neither ever needs to claim MANAGER this way.
 */
async function lookupInvitedMetadata(
  organizationId: string,
  email: string,
  fallbackClerkRole: string
): Promise<{ locationId: string | null; appRole: string }> {
  const { data: invitations } = await clerkClient.organizations.getOrganizationInvitationList({
    organizationId,
    status: ["accepted"],
  })
  const invitation = invitations.find((inv) => inv.emailAddress === email)
  const metadata = invitation?.publicMetadata as Record<string, unknown> | undefined
  const locationId = typeof metadata?.location_id === "string" ? metadata.location_id : null
  const appRole =
    typeof metadata?.app_role === "string"
      ? metadata.app_role
      : fallbackClerkRole === "org:admin"
        ? ROLES.admin
        : ROLES.user
  return { locationId, appRole }
}

/**
 * Keeps the local User/Tenant "read mirror" (name/last_name/email, plus the
 * clerk_user_id/clerk_org_id link columns) in sync with Clerk, which owns
 * identity/credentials/org-membership. Role is the one exception: the local
 * User.role column is authoritative (see resolveAuthContext.ts) and is only
 * ever set here once, when a brand-new local row is first created — never
 * overwritten on a resync, since Clerk itself only tracks a coarse admin/
 * member split and would otherwise clobber a real MANAGER back to USER.
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

        // organization.created isn't guaranteed to have arrived first — an
        // org created via the Backend API with `created_by` in one call
        // (which is what self-serve "create an organization" ultimately
        // does) only reliably fires this event, not a separate
        // organization.created. Upsert here too rather than erroring out
        // and silently dropping the membership (and the new user with it).
        await db
          .insert(Tenant)
          .values({ name: organization.name, slug: organization.slug || organization.id, clerk_org_id: organization.id })
          .onConflictDoNothing({ target: Tenant.clerk_org_id })

        const [tenant] = await db
          .select({ id: Tenant.id })
          .from(Tenant)
          .where(and(eq(Tenant.clerk_org_id, organization.id), isNull(Tenant.deletedAt)))
        if (!tenant) {
          // Only reachable if the tenant was soft-deleted between the
          // upsert and this re-select — genuinely exceptional now.
          logger.error({ orgId: organization.id }, "organizationMembership event for unresolvable tenant")
          break
        }

        const email = public_user_data.identifier ?? ""
        const firstName = public_user_data.first_name ?? ""
        const lastName = public_user_data.last_name ?? ""

        // Link to an existing row by clerk_user_id first (name/status resync
        // — role is never touched here, the local column is authoritative).
        const [existingByClerkId] = await db
          .select({ id: User.id })
          .from(User)
          .where(eq(User.clerk_user_id, public_user_data.user_id))

        if (existingByClerkId) {
          await db
            .update(User)
            .set({
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
          // Pre-existing (e.g. migration-seeded) row — its role/location_id
          // are real app data set by an admin, not something to overwrite
          // from the invitation.
          await db
            .update(User)
            .set({
              clerk_user_id: public_user_data.user_id,
              name: firstName,
              last_name: lastName,
              status: STATUS.active,
              deletedAt: null,
            })
            .where(eq(User.id, existingByEmail.id))
        } else {
          const { locationId, appRole } = await lookupInvitedMetadata(organization.id, email, role)
          await db.insert(User).values({
            clerk_user_id: public_user_data.user_id,
            tenant_id: tenant.id,
            name: firstName || email,
            last_name: lastName,
            email,
            role: appRole,
            status: STATUS.active,
            location_id: locationId,
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
