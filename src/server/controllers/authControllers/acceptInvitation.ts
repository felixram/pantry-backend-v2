import z from "zod"
import { t } from "../../trpc.ts"
import { hashPassword } from "../../../utils/passwordUtils.ts"
import { User } from "../../../db/schema/users.ts"
import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"
import { STATUS } from "../../../types/user.ts"

// Password must be at least 8 characters with uppercase, lowercase, and number
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")

/**
 * Public procedure to accept an invitation
 * Validates the invitation token, sets the password, and activates the user
 */
export const acceptInvitationProcedure = t.procedure
  .input(
    z.object({
      token: z.string().min(1, "Invitation token is required"),
      password: passwordSchema,
    })
  )
  .mutation(async ({ input, ctx }) => {
    // Find user by invitation token
    const [user] = await ctx.db
      .select()
      .from(User)
      .where(eq(User.invitation_token, input.token))

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invalid or expired invitation link.",
      })
    }

    // Check if invitation has expired
    if (user.invitation_expires_at && user.invitation_expires_at < new Date()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This invitation has expired. Please contact your administrator for a new invitation.",
      })
    }

    // Check if user is in PENDING status
    if (user.status !== STATUS.pending) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This invitation has already been used.",
      })
    }

    // Hash the new password
    const passwordHash = await hashPassword(input.password)

    // Update user: set password, clear invitation fields, activate user
    await ctx.db
      .update(User)
      .set({
        password: passwordHash,
        status: STATUS.active,
        invitation_token: null,
        invitation_expires_at: null,
      })
      .where(eq(User.id, user.id))

    return {
      status: "success",
      message: "Account activated successfully. You can now sign in.",
    }
  })
