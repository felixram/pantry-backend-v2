import { TRPCError } from "@trpc/server"
import { adminMutation, t } from "../../trpc.ts"
import { User } from "../../../db/schema/users.ts"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { ROLES, STATUS } from "../../../types/user.ts"
export const deleteUserProcedure = adminMutation
  .input(z.object({ userId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select()
      .from(User)
      .where(eq(User.id, input.userId))

    if (!user || user.deletedAt)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This user cannot be found.",
      })

    // MANAGER can only delete users in their location
    if (ctx.user!.role === ROLES.manager && user.location_id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only manage users in your location",
      })
    }

    const [deletedUser] = await ctx.db
      .update(User)
      .set({ deletedAt: new Date(Date.now()), status: STATUS.inactive })
      .where(eq(User.id, input.userId))
      .returning()

    if (deletedUser?.id === ctx.user?.id)
      ctx.res.cookie("token", "", {
        httpOnly: true,
        expires: new Date(0),
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      })
    return { message: "User has been deleted." }
  })

//check if the user has been deleted already before perform any action. controll logout. only if it is its own account.
