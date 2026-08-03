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

      // Fetch user's location_id and tenant_id from database for access control
      // Also verify user is not soft-deleted — if they are, treat as unauthenticated
      const [dbUser] = await db
        .select({
          id: User.id,
          role: User.role,
          location_id: User.location_id,
          tenant_id: User.tenant_id,
        })
        .from(User)
        .where(and(eq(User.id, jwtPayload.id), isNull(User.deletedAt)))

      if (dbUser) {
        user = jwtPayload
        userLocationId = dbUser.location_id
        tenantId = dbUser.tenant_id

        // Fetch tenant's is_demo flag for demo account restrictions
        // Also verify tenant is not soft-deleted — if it is, treat user as unauthenticated
        if (tenantId) {
          const [tenant] = await db
            .select({ is_demo: Tenant.is_demo })
            .from(Tenant)
            .where(and(eq(Tenant.id, tenantId), isNull(Tenant.deletedAt)))

          if (!tenant) {
            user = null
            userLocationId = null
            tenantId = null
            isDemoTenant = false
          } else {
            isDemoTenant = tenant.is_demo ?? false
          }
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
