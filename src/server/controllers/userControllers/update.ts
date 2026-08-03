import { TRPCError } from "@trpc/server"
import { authedMutation } from "../../trpc.ts"
import { z } from "zod"
import { User } from "../../../db/schema/users.ts"
import { eq } from "drizzle-orm"
import { comparePassword, hashPassword } from "../../../utils/passwordUtils.ts"
import { ROLES } from "../../../types/user.ts"

// Password must be at least 8 characters with uppercase, lowercase, and number
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")

//procedure to update own account
export const updateUser = authedMutation
  .input(
    z.object({
      name: z.string().min(1, "Name is required").optional(),
      last_name: z.string().min(1, "Last name is required").optional(),
      role: z.enum(Object.values(ROLES)).optional(),
      email: z.email("Invalid email format").optional(),
      password: z.string().optional(),
      newPassword: passwordSchema.optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { name, last_name, role, email, password, newPassword } = input

    const [user] = await ctx.db
      .select()
      .from(User)
      .where(eq(User.id, ctx.user!.id))

    if (!user || user.deletedAt)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found.",
      })

    const updateData: Partial<typeof user> = {}

    if (name) updateData.name = name
    if (last_name) updateData.last_name = last_name
    if (email) updateData.email = email

    if (role && ctx.user!.role === ROLES.admin) {
      updateData.role = role
    } else if (role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You dont have permissions to perform this action.",
      })
    }

    if (newPassword && password) {
      const isMatch = await comparePassword(password, user.password)
      if (!isMatch)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials.",
        })
      updateData.password = await hashPassword(newPassword)
    }

    if (Object.keys(updateData).length === 0)
      return { message: "There are no changes to apply." }

    await ctx.db.update(User).set(updateData).where(eq(User.id, ctx.user!.id))

    return { message: "User updated" }
  })
