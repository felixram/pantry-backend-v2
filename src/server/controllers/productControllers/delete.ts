import z from "zod"
import { adminMutation } from "../../trpc.ts"
import { Product } from "../../../db/schema/product.ts"
import { eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

export const deleteProductProcedure = adminMutation
  .input(
    z.object({
      productId: z.string(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Only full admins can delete products
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can delete products",
      })
    }

    const [deletedProduct] = await ctx.db
      .update(Product)
      .set({ deletedAt: new Date() })
      .where(eq(Product.id, input.productId))
      .returning()

    if (!deletedProduct) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Product not found.",
      })
    }

    return { message: "Product deleted successfully." }
  })
