import { adminMutation } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { and, eq } from "drizzle-orm"
import { CountSortOrder } from "../../../db/schema/countSortOrder.ts"
import { validateLocationAccess } from "../../../utils/locationFilter.ts"
import { z } from "zod"

export const saveCountSortOrder = adminMutation
  .input(
    z.object({
      location_id: z.string().uuid(),
      order: z.array(
        z.object({
          category_id: z.string().uuid(),
          product_id: z.string().uuid().nullable(),
          sort_order: z.number().int().min(0),
          excluded: z.boolean(),
        })
      ),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
    }

    // Validate location access for managers
    validateLocationAccess(ctx.user!, ctx.userLocationId, input.location_id)

    await ctx.db.transaction(async (tx) => {
      // Delete existing sort order for this location
      await tx
        .delete(CountSortOrder)
        .where(
          and(
            eq(CountSortOrder.tenant_id, ctx.tenantId!),
            eq(CountSortOrder.location_id, input.location_id)
          )
        )

      // Insert new sort order
      if (input.order.length > 0) {
        await tx.insert(CountSortOrder).values(
          input.order.map((item) => ({
            tenant_id: ctx.tenantId!,
            location_id: input.location_id,
            category_id: item.category_id,
            product_id: item.product_id,
            sort_order: item.sort_order,
            excluded: item.excluded,
          }))
        )
      }
    })

    return { success: true }
  })
