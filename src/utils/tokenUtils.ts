import jwt from "jsonwebtoken"
import type { jwtTypes } from "../types/jwtTypes.ts"

export const createJWT = (payload: jwtTypes) => {
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
