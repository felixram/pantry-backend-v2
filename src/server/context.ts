import type { CreateExpressContextOptions } from "@trpc/server/adapters/express"
import { db } from "../db/index.ts"
import { resolveAuthContext } from "../utils/resolveAuthContext.ts"
import { resolveOwnerContext } from "../utils/resolveOwnerContext.ts"

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const { user, userLocationId, tenantId, isDemoTenant, clerkUserId, clerkOrgId } =
    await resolveAuthContext(req)
  const isOwner = resolveOwnerContext(req)

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
    isOwner,
  }
}
