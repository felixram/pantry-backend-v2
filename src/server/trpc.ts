import { initTRPC, TRPCError } from "@trpc/server"
import type { createContext } from "./context.ts"
import { hasElevatedRole, ROLES } from "../types/user.ts"

export const t = initTRPC
  .context<Awaited<ReturnType<typeof createContext>>>()
  .create({
    errorFormatter({ shape, error }) {
      // Intentional TRPCErrors (NOT_FOUND, CONFLICT, etc.) already have friendly messages — pass through.
      // For INTERNAL_SERVER_ERROR: check if it was auto-wrapped from an unhandled error (has external cause).
      // If so, replace the message to prevent leaking raw SQL/params to the client.
      if (error.code === "INTERNAL_SERVER_ERROR") {
        const isUnhandled = error.cause && !(error.cause instanceof TRPCError)
        if (isUnhandled) {
          return {
            ...shape,
            message: "An unexpected error occurred. Please try again or contact support.",
            data: {
              ...shape.data,
              stack: undefined,
            },
          }
        }
      }
      return shape
    },
  })

//admin procedure

const isAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user || !hasElevatedRole(ctx.user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You dont have permissions to perform this action.",
    })
  }
  return next()
})

// Despite the name, adminProcedure above actually means "elevated role"
// (ADMIN or MANAGER) — this one is for the rare case that genuinely needs
// to exclude MANAGER too (e.g. Reports, which surface tenant-wide financial
// figures MANAGER shouldn't see).
const isStrictAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role !== ROLES.admin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You dont have permissions to perform this action.",
    })
  }
  return next()
})

// App-owner-only console (see routers/owner/owner.ts) — completely
// independent of ctx.user/tenant. Gated on ctx.isOwner, set in context.ts
// from the owner-console's own JWT (utils/ownerAuth.ts), never from Clerk.
const isOwner = t.middleware(({ ctx, next }) => {
  if (!ctx.isOwner) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You dont have permissions to perform this action.",
    })
  }
  return next()
})

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You need to be logged it to perform this action",
    })

  return next()
})

// Demo tenant guard - blocks mutations for demo accounts
const isNotDemoTenant = t.middleware(({ ctx, next }) => {
  if (ctx.isDemoTenant) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This is a demo account. Modifications are not allowed.",
    })
  }
  return next()
})

// Query procedures (unchanged - work for demo accounts)
export const adminProcedure = t.procedure.use(isAdmin)
export const authedProcedure = t.procedure.use(isAuthed)
export const strictAdminProcedure = t.procedure.use(isStrictAdmin)
export const ownerProcedure = t.procedure.use(isOwner)

// Mutation procedures (blocked for demo accounts)
export const adminMutation = t.procedure.use(isAdmin).use(isNotDemoTenant)
export const authedMutation = t.procedure.use(isAuthed).use(isNotDemoTenant)
