import { eq } from "drizzle-orm"
import { Supplier } from "../../../db/schema/supplier.ts"
import { authedMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const deleteSupplierProcedure = authedMutation
  .input(
    z.object({
      id: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const [deletedSupplier] = await ctx.db
      .update(Supplier)
      .set({ deletedAt: new Date(Date.now()) })
      .where(eq(Supplier.id, input.id))
      .returning()

    if (!deletedSupplier) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Supplier not found.",
      })
    }

    return { message: "Supplier successfully deleted" }
  })
