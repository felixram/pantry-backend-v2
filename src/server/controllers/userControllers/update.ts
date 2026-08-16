import { TRPCError } from "@trpc/server"
import { authedMutation } from "../../trpc.ts"
import { z } from "zod"
import { User } from "../../../db/schema/users.ts"
import { eq } from "drizzle-orm"

// Self-service update of the acting user's own display name. Credentials,
// role, and email are Clerk's job now (role additionally can't be
// self-assigned — that was always admin-only, and admin role changes now go
// through Clerk via adminUpdate.ts). email is a webhook-synced mirror of
// Clerk's own identity, so it isn't editable here either.
export const updateUser = authedMutation
  .input(
    z.object({
      name: z.string().min(1, "Name is required").optional(),
      last_name: z.string().min(1, "Last name is required").optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { name, last_name } = input

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

    if (Object.keys(updateData).length === 0)
      return { message: "There are no changes to apply." }

    await ctx.db.update(User).set(updateData).where(eq(User.id, ctx.user!.id))

    return { message: "User updated" }
  })
