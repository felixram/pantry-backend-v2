import { TRPCError } from "@trpc/server"
import { t } from "../server/trpc.ts"

export const isLoggedIn = t.middleware(({ ctx, next }) => {
  if (!ctx.user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Please log in.",
    })

  return next()
})

export const loggedInProcedure = t.procedure.use(isLoggedIn)
