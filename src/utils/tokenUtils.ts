import jwt from "jsonwebtoken"
import type { jwtTypes } from "../types/jwtTypes.ts"

// Narrow, standalone JWT mechanism for the inventory-count magic-link flow
// only — normal account sessions are Clerk's job now (see
// resolveAuthContext.ts). Kept separate because magic-link recipients don't
// have (and shouldn't need) a real Clerk account.

/** Signs the short-lived cookie set once a magic-link token has been validated. */
export const createCountSessionToken = (payload: jwtTypes) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  })
  return token
}

export const verifyToken = (token: string) => {
  return jwt.verify(token, process.env.JWT_SECRET!) as jwtTypes
}

export const createMagicLinkToken = (payload: jwtTypes) => {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "24h" })
}
