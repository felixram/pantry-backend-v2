/**
 * One-off clean-slate migration: link existing Tenants/Users to Clerk.
 *
 * For each real (non-demo, non-deleted) Tenant without a clerk_org_id yet:
 *   - creates a matching Clerk Organization, sets clerk_org_id
 * For each active (non-deleted) User under it without a clerk_user_id yet:
 *   - sends a Clerk org invitation to their email with the mapped role
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
 * Run with: npx tsx scripts/migrateToClerk.ts
 */

import "dotenv/config"
import { clerkClient } from "@clerk/express"
import { db } from "../src/db/index.ts"
import { Tenant } from "../src/db/schema/tenant.ts"
import { User } from "../src/db/schema/users.ts"
import { ROLES } from "../src/types/user.ts"
import { and, eq, isNull } from "drizzle-orm"

const ROLE_TO_ORG_ROLE: Record<string, string> = {
  [ROLES.admin]: "org:admin",
  [ROLES.manager]: "org:manager",
  [ROLES.user]: "org:member",
}

// The dev DB's "Default Organization" tenant accumulated ~50 faker-seeded
// test users (test@test.com, houston.veum64@gmail.com, etc.) from an old
// seed script — real inboxes we don't own could exist at some of those
// addresses. Only the accounts actually used for hands-on testing get a
// real Clerk invitation email; everyone else is left unlinked (they simply
// won't be able to sign in post-migration, which is fine — they were never
// used for real testing).
const REAL_TEST_EMAILS = new Set([
  "admin@aki-inventory.com",
  "felixramses.2@gmail.com",
  "felix@mukuy.com",
  "felix@akimorinyc.com",
])

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
    .where(and(eq(User.tenant_id, tenant.id), isNull(User.deletedAt)))

  for (const user of users) {
    if (!REAL_TEST_EMAILS.has(user.email)) {
      continue
    }

    if (user.clerk_user_id) {
      console.log(`  · ${user.email} — already linked, skipping`)
      continue
    }

    const role = ROLE_TO_ORG_ROLE[user.role]
    if (!role) {
      console.warn(`  ! ${user.email} — unrecognized role "${user.role}", skipping`)
      continue
    }

    try {
      await clerkClient.organizations.createOrganizationInvitation({
        organizationId: clerkOrgId,
        emailAddress: user.email,
        role,
        // Without this, the invitation link points at Clerk's hosted Account
        // Portal, which 404s for a dev instance not set up for it — route
        // through our own /sign-up page instead (reads __clerk_ticket).
        redirectUrl: `${process.env.CLERK_APP_URL || "http://localhost:3001"}/sign-up`,
      })
      console.log(`  ✓ Invited ${user.email} (${role})`)
    } catch (err) {
      console.warn(`  ! ${user.email} — invitation failed (likely already pending): ${(err as Error).message}`)
    }
  }
}

async function migrateToClerk() {
  console.log("🔑 Starting clean-slate Clerk migration...")

  const tenants = await db
    .select()
    .from(Tenant)
    .where(and(eq(Tenant.is_demo, false), isNull(Tenant.deletedAt)))

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
