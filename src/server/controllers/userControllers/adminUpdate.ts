import { z } from "zod"
import { ROLES, STATUS, isLocationScoped } from "../../../types/user.ts"
import { adminMutation } from "../../trpc.ts"
import { hashPassword } from "../../../utils/passwordUtils.ts"
import { User } from "../../../db/schema/users.ts"
import { and, eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

// Password must be at least 8 characters with uppercase, lowercase, and number
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")

//procedure to update third party accounts
export const adminUpdateProcedure = adminMutation
  .input(
    z.object({
      userId: z.string().uuid("Invalid user ID"),
      password: passwordSchema.optional(),
      role: z.enum(Object.values(ROLES)).optional(),
      status: z.enum(Object.values(STATUS)).optional(),
      location_id: z.string().uuid().nullable().optional(), // Nullable to clear, optional to skip
    })
  )
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const { password } = input

    // Was unscoped by tenant — any elevated user in any tenant could set
    // the password/role/status/location of any other tenant's user by id.
    const existingUser = await ctx.db.query.User.findFirst({
      where: and(eq(User.id, input.userId), eq(User.tenant_id, ctx.tenantId)),
    })

    if (!existingUser || existingUser.deletedAt) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found.",
      })
    }

    // MANAGER restrictions: cannot promote to admin, can only manage users at their location
    if (ctx.user!.role === ROLES.manager) {
      if (input.role === ROLES.admin || input.role === ROLES.manager) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers can only assign the user role",
        })
      }
      if (existingUser.location_id !== ctx.userLocationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers can only manage users in their own location",
        })
      }
      if (input.location_id !== undefined) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Managers cannot change user locations",
        })
      }
    }

    const updateData: Partial<typeof existingUser> & { updatedAt: Date } = {
      updatedAt: new Date(Date.now()),
    }

    if (input.role) updateData.role = input.role
    if (input.status) updateData.status = input.status
    if (password) updateData.password = await hashPassword(password)

    // Handle location_id updates with role-based validation
    if (input.location_id !== undefined) {
      // Determine the effective role after this update
      const effectiveRole = input.role || existingUser.role

      // Validate: location-scoped roles must have a location, ADMIN cannot have one
      if (isLocationScoped(effectiveRole) && !input.location_id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This role must be assigned to a location",
        })
      }

      if (effectiveRole === ROLES.admin && input.location_id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Admin users cannot be assigned to a specific location",
        })
      }

      updateData.location_id = input.location_id
    }

    // Also validate if only role is changing (location consistency check)
    if (input.role && input.location_id === undefined) {
      const currentLocationId = existingUser.location_id

      if (isLocationScoped(input.role) && !currentLocationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change to this role without assigning a location",
        })
      }

      if (input.role === ROLES.admin && currentLocationId) {
        // Auto-clear location when promoting to admin
        updateData.location_id = null
      }
    }

    const [updatedUser] = await ctx.db
      .update(User)
      .set(updateData)
      .where(and(eq(User.id, input.userId), eq(User.tenant_id, ctx.tenantId)))
      .returning()

    if (!updatedUser) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update user.",
      })
    }

    return { message: "User updated!" }
  })
