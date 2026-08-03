/**
 * Server-side tRPC caller for SSR data fetching
 *
 * This allows us to call tRPC procedures directly on the server
 * without going through HTTP, enabling efficient SSR data prefetching.
 */
import { appRouter } from "../server/routers/index.ts"
import { db } from "../db/index.ts"
import { User } from "../db/schema/users.ts"
import { Tenant } from "../db/schema/tenant.ts"
import { eq } from "drizzle-orm"
import type { jwtTypes } from "../types/jwtTypes.ts"

// Define the caller type based on the router
export type ServerCaller = ReturnType<typeof appRouter.createCaller>

/**
 * Creates a server-side tRPC caller with the given user context
 *
 * @param user - JWT payload of the authenticated user (or null for unauthenticated)
 * @returns A callable tRPC router that can invoke procedures directly
 */
export async function createServerCaller(user: jwtTypes | null): Promise<ServerCaller> {
  let userLocationId: string | null = null
  let tenantId: string | null = null
  let isDemoTenant = false

  if (user) {
    // Fetch user's location_id and tenant_id from database for access control
    const [dbUser] = await db
      .select({
        location_id: User.location_id,
        tenant_id: User.tenant_id,
      })
      .from(User)
      .where(eq(User.id, user.id))

    if (dbUser) {
      userLocationId = dbUser.location_id
      tenantId = dbUser.tenant_id

      // Fetch tenant's is_demo flag for demo account restrictions
      if (tenantId) {
        const [tenant] = await db
          .select({ is_demo: Tenant.is_demo })
          .from(Tenant)
          .where(eq(Tenant.id, tenantId))

        isDemoTenant = tenant?.is_demo ?? false
      }
    }
  }

  // Create the caller with the same context shape as HTTP requests
  // SSR doesn't use req/res but the context type requires them
  const caller = appRouter.createCaller({
    req: {} as any,
    res: {} as any,
    db,
    user,
    userLocationId,
    tenantId,
    isDemoTenant,
  })

  return caller
}
