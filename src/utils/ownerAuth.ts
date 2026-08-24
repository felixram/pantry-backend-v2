import jwt from "jsonwebtoken"
import { randomBytes, scryptSync, timingSafeEqual } from "crypto"

// Standalone auth mechanism for the app-owner-only usage console
// (src/server/routers/owner/owner.ts) — entirely separate from both Clerk
// (tenant accounts) and the count_session magic-link flow (tokenUtils.ts).
// There is exactly one owner account, credentials live in env vars
// (OWNER_EMAIL / OWNER_PASSWORD_HASH), not in the tenant-scoped User table.

const OWNER_TOKEN_PURPOSE = "owner_session"

/** Run once to produce the value for OWNER_PASSWORD_HASH — see README note in ownerLogin.ts. */
export function hashOwnerPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

export function verifyOwnerPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":")
  if (!salt || !hash) return false

  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, "hex")
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

export function createOwnerSessionToken(): string {
  return jwt.sign({ purpose: OWNER_TOKEN_PURPOSE }, process.env.JWT_SECRET!, { expiresIn: "30d" })
}

export function verifyOwnerSessionToken(token: string): boolean {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { purpose?: string }
    return payload.purpose === OWNER_TOKEN_PURPOSE
  } catch {
    return false
  }
}
