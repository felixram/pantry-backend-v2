import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Location } from "../../../db/schema/location.ts";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ROLES } from "../../../types/user.ts";

export const deleteLocationProcedure = adminMutation
  .input(z.object({ id: z.uuid() }))
  .mutation(async ({ ctx, input }) => {
    // Only full admins can delete locations
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can delete locations",
      })
    }

    const [deletedLocation] = await ctx.db
      .update(Location)
      .set({
        active: false,
        deletedAt: new Date(Date.now()),
        deletedBy: ctx.user?.id,
      })
      .where(eq(Location.id, input.id))
      .returning()

    if (!deletedLocation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Location not found.",
      })
    }

    return { message: "Location deleted successfully." }
  })
