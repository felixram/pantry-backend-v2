import z from "zod"
import { adminMutation, t } from "../../trpc.ts"
import { hashPassword } from "../../../utils/passwordUtils.ts"
import { User } from "../../../db/schema/users.ts"
import { TRPCError } from "@trpc/server"
import { and, eq, isNull, isNotNull } from "drizzle-orm"
import { ROLES, STATUS, hasElevatedRole, isLocationScoped } from "../../../types/user.ts"
import { handleDbError } from "../../../utils/dbErrors.ts"

// Password must be at least 8 characters with uppercase, lowercase, and number
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")

export const createUserProcedure = adminMutation
  .input(
    z.object({
      name: z.string().min(1, "Name is required"),
      lastName: z.string().min(1, "Last name is required"),
      email: z.email("Invalid email format"),
      password: passwordSchema,
      role: z.enum(Object.values(ROLES)).optional(),
      location_id: z.string().uuid().optional(), // Required for USER role, null for ADMIN
    })
  )
  .mutation(async ({ input, ctx }) => {
    const firstAccount = await ctx.db.query.User.findFirst({
      where: and(eq(User.role, ROLES.admin), eq(User.status, STATUS.active)),
    })

    if (firstAccount && !hasElevatedRole(ctx.user?.role ?? "")) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You dont have permissions to perform this action",
      })
    }

    // Require tenant context for user creation
    // Note: First account creation should now use tenantSignup endpoint instead
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required. Use the organization signup to create your first account.",
      })
    }

    // Check for active user with this email
    const [activeUser] = await ctx.db
      .select()
      .from(User)
      .where(and(eq(User.email, input.email), isNull(User.deletedAt)))

    if (activeUser) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User already exists",
      })
    }

    // Check for deleted user with this email - offer reactivation/hard delete
    const [deletedUser] = await ctx.db
      .select()
      .from(User)
      .where(and(eq(User.email, input.email), isNotNull(User.deletedAt)))

    if (deletedUser) {
      const deletedUserData = {
        id: deletedUser.id,
        name: deletedUser.name,
        email: deletedUser.email,
        deletedAt: deletedUser.deletedAt!.toISOString(),
      }
      throw new TRPCError({
        code: "CONFLICT",
        message: `DELETED_USER:${JSON.stringify(deletedUserData)}`,
      })
    }

    // Determine the effective role (first account is always admin)
    const effectiveRole = !firstAccount ? ROLES.admin : input.role || ROLES.user

    // Validate location assignment based on role
    if (isLocationScoped(effectiveRole) && !input.location_id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Location is required for this role",
      })
    }

    if (effectiveRole === ROLES.admin && input.location_id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Admin users cannot be assigned to a specific location",
      })
    }

    const passwordhash = await hashPassword(input.password)

    let newUser
    try {
      const [inserted] = await ctx.db
        .insert(User)
        .values({
          name: input.name,
          last_name: input.lastName,
          email: input.email,
          password: passwordhash,
          role: effectiveRole,
          status: STATUS.active,
          location_id: input.location_id,
          tenant_id: ctx.tenantId!,
        })
        .returning()
      newUser = inserted
    } catch (error) {
      throw handleDbError(error, {
        uniqueViolation: "A user with this email already exists.",
      })
    }

    return { status: "success", userId: newUser!.id }
  })
