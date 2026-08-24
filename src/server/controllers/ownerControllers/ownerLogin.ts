import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { t } from "../../trpc.ts"
import { verifyOwnerPassword, createOwnerSessionToken } from "../../../utils/ownerAuth.ts"

// Public procedure (no ctx.user/ctx.isOwner required to call it — that's
// the point, this IS the login). Requires OWNER_EMAIL + OWNER_PASSWORD_HASH
// in env (see utils/ownerAuth.ts's hashOwnerPassword to generate the hash).
export const ownerLogin = t.procedure
  .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .mutation(async ({ input }) => {
    const ownerEmail = process.env.OWNER_EMAIL
    const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH

    if (!ownerEmail || !ownerPasswordHash) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Owner console is not configured on this server.",
      })
    }

    const emailMatches = input.email.toLowerCase() === ownerEmail.toLowerCase()
    const passwordMatches = verifyOwnerPassword(input.password, ownerPasswordHash)

    if (!emailMatches || !passwordMatches) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" })
    }

    return { token: createOwnerSessionToken() }
  })
