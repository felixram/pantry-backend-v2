import type { CreateExpressContextOptions } from "@trpc/server/adapters/express"
import { db } from "../db/index.ts"
import { verifyToken } from "../utils/tokenUtils.ts"
import { User } from "../db/schema/users.ts"
import { Tenant } from "../db/schema/tenant.ts"
import { and, eq, isNull } from "drizzle-orm"

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const token = req.cookies?.token

  let user = null
  let userLocationId: string | null = null
  let tenantId: string | null = null
  let isDemoTenant = false

  if (token) {
    try {
      const jwtPayload = verifyToken(token)

      // Single joined query instead of a user lookup followed by a separate
      // tenant lookup — this runs on every request, and each round trip to
      // the DB costs real network latency, so two sequential ones doubled
      // the cost for no reason. The join's ON clause already filters out a
      // soft-deleted tenant (isNull(Tenant.deletedAt)), so `tenant_is_demo`
      // coming back null unambiguously means "no active tenant" — is_demo
      // is NOT NULL on real rows — whether because tenant_id is null,
      // the tenant was soft-deleted, or (shouldn't happen) it's missing.
      const [row] = await db
        .select({
          location_id: User.location_id,
          tenant_id: User.tenant_id,
          tenant_is_demo: Tenant.is_demo,
        })
        .from(User)
        .leftJoin(Tenant, and(eq(User.tenant_id, Tenant.id), isNull(Tenant.deletedAt)))
        .where(and(eq(User.id, jwtPayload.id), isNull(User.deletedAt)))

      if (row) {
        if (row.tenant_id && row.tenant_is_demo === null) {
          // User has a tenant_id, but no active tenant matched — soft-deleted
          // or missing. Same as the old code's "if (!tenant)" branch.
          user = null
          userLocationId = null
          tenantId = null
          isDemoTenant = false
        } else {
          user = jwtPayload
          userLocationId = row.location_id
          tenantId = row.tenant_id
          isDemoTenant = row.tenant_is_demo ?? false
        }
      }
    } catch (error) {
      user = null
      userLocationId = null
      tenantId = null
      isDemoTenant = false
    }
  }

  return {
    req,
    res,
    db,
    user,
    userLocationId,
    tenantId,
    isDemoTenant,
  }
}
