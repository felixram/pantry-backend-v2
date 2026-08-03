import z from "zod"
import crypto from "crypto"
import { t } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { and, eq, isNull } from "drizzle-orm"
import { STATUS } from "../../../types/user.ts"
import { sendPasswordResetEmail } from "../../../services/email/index.ts"

/**
 * Public procedure to request a password reset
 * Sends an email with a reset link if the email exists
 * Always returns success to prevent email enumeration
 */
export const forgotPasswordProcedure = t.procedure
  .input(
    z.object({
      email: z.string().email("Invalid email format"),
    })
  )
  .mutation(async ({ input, ctx }) => {
    // Find user by email (must be active)
    const [user] = await ctx.db
      .select()
      .from(User)
      .where(
        and(
          eq(User.email, input.email),
          eq(User.status, STATUS.active),
          isNull(User.deletedAt)
        )
      )

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return {
        status: "success",
        message:
          "If an account exists with this email, you will receive a password reset link.",
      }
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Save token to database
    await ctx.db
      .update(User)
      .set({
        password_reset_token: resetToken,
        password_reset_expires_at: expiresAt,
      })
      .where(eq(User.id, user.id))

    // Build reset URL
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
    const resetUrl = `${clientUrl}/reset-password?token=${resetToken}`

    // Send email
    await sendPasswordResetEmail({
      to: user.email,
      userName: user.name,
      resetUrl,
      expiresAt,
    })

    return {
      status: "success",
      message:
        "If an account exists with this email, you will receive a password reset link.",
    }
  })
