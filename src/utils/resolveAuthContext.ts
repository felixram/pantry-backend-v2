import { getAuth } from "@clerk/express"
import type { Request } from "express"
import { and, eq, isNull, type SQL } from "drizzle-orm"
import { db } from "../db/index.ts"
import { User } from "../db/schema/users.ts"
import { Tenant } from "../db/schema/tenant.ts"
import { STATUS } from "../types/user.ts"
import { verifyToken } from "./tokenUtils.ts"
import type { jwtTypes } from "../types/jwtTypes.ts"

export interface ResolvedAuthContext {
  user: jwtTypes | null
  userLocationId: string | null
  tenantId: string | null
  isDemoTenant: boolean
  // Raw Clerk ids for the acting user/org, when authenticated via Clerk (null
  // for the magic-link fallback). Used by the handful of admin procedures
  // that call the Clerk Backend API directly (invite, adminUpdate, delete,
  // hardDelete) instead of re-deriving them from a DB lookup each time.
  clerkUserId: string | null
  clerkOrgId: string | null
}

const EMPTY_AUTH_CONTEXT: ResolvedAuthContext = {
  user: null,
  userLocationId: null,
  tenantId: null,
  isDemoTenant: false,
  clerkUserId: null,
  clerkOrgId: null,
}

type LocalUserContext = Omit<ResolvedAuthContext, "clerkUserId" | "clerkOrgId">

const EMPTY_LOCAL_CONTEXT: LocalUserContext = {
  user: null,
  userLocationId: null,
  tenantId: null,
  isDemoTenant: false,
}

/** Shared "local uuid + tenant/location" lookup, keyed either by Clerk user id or by a plain User.id (magic-link path). */
async function loadUserContext(where: SQL): Promise<LocalUserContext> {
  const [row] = await db
    .select({
      id: User.id,
      role: User.role,
      location_id: User.location_id,
      tenant_id: User.tenant_id,
      tenant_is_demo: Tenant.is_demo,
    })
    .from(User)
    .innerJoin(Tenant, and(eq(User.tenant_id, Tenant.id), isNull(Tenant.deletedAt)))
    .where(and(where, eq(User.status, STATUS.active), isNull(User.deletedAt)))

  if (!row) return EMPTY_LOCAL_CONTEXT

  return {
    user: { id: row.id, role: row.role },
    userLocationId: row.location_id,
    tenantId: row.tenant_id,
    isDemoTenant: row.tenant_is_demo ?? false,
  }
}

/**
 * Single source of truth for turning an authenticated request into our
 * app's user/tenant/location context. Used by both the tRPC context
 * (context.ts) and the invoice-upload REST route, which previously each
 * duplicated this resolution against the old JWT cookie independently.
 *
 * Two independent auth mechanisms feed into this, tried in order:
 *  1. Clerk session (normal account login) — Clerk only tracks a coarse
 *     admin/member org role (see toClerkOrgRole in types/user.ts — a third
 *     custom role costs extra on Clerk's pricing), so the real ADMIN/
 *     MANAGER/USER role is read from the local User.role mirror instead of
 *     the session claim. That mirror is authoritative and written directly
 *     by adminUpdate.ts / on first invitation acceptance
 *     (clerkWebhookHandler.ts), not resynced from Clerk after the fact.
 *  2. The inventory-count magic-link session cookie (`count_session`) — a
 *     narrow, Clerk-independent flow for staff without a real account (see
 *     authControllers/validateMagicLink.ts). Role here comes from the same
 *     local mirror column since there's no Clerk claim to read it from.
 */
export async function resolveAuthContext(req: Request): Promise<ResolvedAuthContext> {
  const { userId, orgId } = getAuth(req)
  if (userId && orgId) {
    const local = await loadUserContext(
      and(eq(User.clerk_user_id, userId), eq(Tenant.clerk_org_id, orgId))!
    )
    if (!local.user) return EMPTY_AUTH_CONTEXT

    return {
      ...local,
      clerkUserId: userId,
      clerkOrgId: orgId,
    }
  }

  const magicLinkCookie = req.cookies?.count_session
  if (magicLinkCookie) {
    try {
      const payload = verifyToken(magicLinkCookie)
      const local = await loadUserContext(eq(User.id, payload.id))
      return { ...local, clerkUserId: null, clerkOrgId: null }
    } catch {
      return EMPTY_AUTH_CONTEXT
    }
  }

  return EMPTY_AUTH_CONTEXT
}
