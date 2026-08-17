/**
 * Production cutover migration: link existing Tenants/Users to Clerk.
 *
 * For each real (non-demo, non-deleted) Tenant without a clerk_org_id yet:
 *   - creates a matching Clerk Organization, sets clerk_org_id
 * For every active (non-deleted) user under it without a clerk_user_id yet:
 *   - sends a Clerk org invitation to their real email with the mapped role
 *
 * No password/hash migration — invited users set their own new password via
 * Clerk's own invite-acceptance flow. Acceptance triggers the
 * organizationMembership.created webhook (clerkWebhookHandler.ts), which
 * matches the existing local row by email within the tenant and links
 * clerk_user_id.
 *
 * Idempotent: safe to re-run. Tenants that already have a clerk_org_id are
 * skipped; users that already have a clerk_user_id are skipped; an invite
 * that fails because one is already pending for that email is logged and
 * skipped rather than aborting the run.
 *
 * Sends real invitation emails to every real active user — run this once,
 * at cutover time, against the production DATABASE_URL and production Clerk
 * keys, only after the production Clerk webhook is confirmed live (so
 * accepted invitations link back correctly). Also requires CLERK_APP_URL to
 * be set to the production frontend domain — invitation links otherwise
 * point at localhost.
 *
 * Optionally scope to one real tenant via TENANT_SLUG — the production DB
 * has real customer tenants mixed in with test/staging ones (only is_demo
 * is tracked, and most test tenants aren't flagged that way), so a blind
 * run would email real invitations to test-tenant users too.
 *
 * Run with: TENANT_SLUG=akimori npx tsx scripts/migrateToClerk.ts
 */

import "dotenv/config"
import { clerkClient } from "@clerk/express"
import { db } from "../src/db/index.ts"
import { Tenant } from "../src/db/schema/tenant.ts"
import { User } from "../src/db/schema/users.ts"
import { STATUS, toClerkOrgRole } from "../src/types/user.ts"
import { and, eq, isNull } from "drizzle-orm"

async function migrateTenant(tenant: typeof Tenant.$inferSelect) {
  let clerkOrgId = tenant.clerk_org_id

  if (!clerkOrgId) {
    console.log(`\n📦 Tenant "${tenant.name}" (${tenant.slug}) — creating Clerk organization...`)
    // Slugs are disabled on this Clerk instance (organization_settings.slug_disabled).
    const org = await clerkClient.organizations.createOrganization({
      name: tenant.name,
    })
    clerkOrgId = org.id
    await db.update(Tenant).set({ clerk_org_id: clerkOrgId }).where(eq(Tenant.id, tenant.id))
    console.log(`  ✓ Created org ${clerkOrgId}`)
  } else {
    console.log(`\n📦 Tenant "${tenant.name}" (${tenant.slug}) — already linked to ${clerkOrgId}`)
  }

  const users = await db
    .select()
    .from(User)
    .where(and(eq(User.tenant_id, tenant.id), eq(User.status, STATUS.active), isNull(User.deletedAt)))

  for (const user of users) {
    if (user.clerk_user_id) {
      console.log(`  · ${user.email} — already linked, skipping`)
      continue
    }

    try {
      await clerkClient.organizations.createOrganizationInvitation({
        organizationId: clerkOrgId,
        emailAddress: user.email,
        role: toClerkOrgRole(user.role),
        // Clerk only tracks the coarse admin/member role above — the real
        // ADMIN/MANAGER/USER role rides in publicMetadata instead, same as
        // invite.ts, and is read back by clerkWebhookHandler.ts on accept.
        publicMetadata: { app_role: user.role },
        // Without this, the invitation link points at Clerk's hosted Account
        // Portal, which 404s for a dev instance not set up for it — route
        // through our own /sign-up page instead (reads __clerk_ticket).
        redirectUrl: `${process.env.CLERK_APP_URL || "http://localhost:3001"}/sign-up`,
      })
      console.log(`  ✓ Invited ${user.email} (${user.role})`)
    } catch (err) {
      console.warn(`  ! ${user.email} — invitation failed (likely already pending): ${(err as Error).message}`)
    }
  }
}

async function migrateToClerk() {
  console.log("🔑 Starting Clerk migration...")

  const tenantSlug = process.env.TENANT_SLUG
  const tenants = await db
    .select()
    .from(Tenant)
    .where(
      tenantSlug
        ? and(eq(Tenant.slug, tenantSlug), isNull(Tenant.deletedAt))
        : and(eq(Tenant.is_demo, false), isNull(Tenant.deletedAt))
    )

  if (tenantSlug && tenants.length === 0) {
    throw new Error(`No tenant found with slug "${tenantSlug}"`)
  }

  for (const tenant of tenants) {
    try {
      await migrateTenant(tenant)
    } catch (err) {
      console.error(`  ✗ Tenant "${tenant.name}" migration failed:`, err)
    }
  }

  console.log(
    "\n✅ Migration complete. Invited users must accept their Clerk invitation email to finish linking."
  )
  process.exit(0)
}

migrateToClerk().catch((err) => {
  console.error("❌ Migration failed:", err)
  process.exit(1)
})
