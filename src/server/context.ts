import type { CreateExpressContextOptions } from "@trpc/server/adapters/express"
import { db } from "../db/index.ts"
import { resolveAuthContext } from "../utils/resolveAuthContext.ts"

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const { user, userLocationId, tenantId, isDemoTenant, clerkUserId, clerkOrgId } =
    await resolveAuthContext(req)

  return {
    req,
    res,
    db,
    user,
    userLocationId,
    tenantId,
    isDemoTenant,
    clerkUserId,
    clerkOrgId,
  }
}
