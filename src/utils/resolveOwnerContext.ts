import type { Request } from "express"
import { verifyOwnerSessionToken } from "./ownerAuth.ts"

// Deliberately its own header (x-owner-token), not Authorization — the
// owner console never sends a Clerk session, and reusing Authorization
// would put an owner JWT through Clerk's own Bearer-token parsing for no
// reason (clerkMiddleware() runs on every request regardless).
export function resolveOwnerContext(req: Request): boolean {
  const header = req.headers["x-owner-token"]
  const token = Array.isArray(header) ? header[0] : header
  if (!token) return false
  return verifyOwnerSessionToken(token)
}
