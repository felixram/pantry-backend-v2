import z from "zod"
import { t } from "../../trpc.ts"
import { hashPassword } from "../../../utils/passwordUtils.ts"
import { User } from "../../../db/schema/users.ts"
import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")

/**
 * Public procedure to reset password using a valid token
 */
export const resetPasswordProcedure = t.procedure
  .input(
    z.object({
      token: z.string().min(1, "Reset token is required"),
      password: passwordSchema,
    })
  )
  .mutation(async ({ input, ctx }) => {
    // Find user by reset token
    const [user] = await ctx.db
      .select()
      .from(User)
      .where(eq(User.password_reset_token, input.token))

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invalid or expired reset link. Please request a new one.",
      })
    }

    // Check if token has expired
    if (
      user.password_reset_expires_at &&
      user.password_reset_expires_at < new Date()
    ) {
      // Clear the expired token
      await ctx.db
        .update(User)
        .set({
          password_reset_token: null,
          password_reset_expires_at: null,
        })
        .where(eq(User.id, user.id))

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This reset link has expired. Please request a new one.",
      })
    }

    // Hash the new password
    const passwordHash = await hashPassword(input.password)

    // Update password and clear reset token
    await ctx.db
      .update(User)
      .set({
        password: passwordHash,
        password_reset_token: null,
        password_reset_expires_at: null,
      })
      .where(eq(User.id, user.id))

    return {
      status: "success",
      message:
        "Password reset successfully. You can now sign in with your new password.",
    }
  })
