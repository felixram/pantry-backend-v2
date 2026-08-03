import { TRPCError } from "@trpc/server"
import { t } from "../server/trpc.ts"
import { ROLES } from "../types/user.ts"

export const isAdmin = t.middleware(({ ctx, next }) => {
  if (ctx.user?.role !== ROLES.admin)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access not authorized.",
    })

  return next()
})

export const adminProcedure = t.procedure.use(isAdmin)
