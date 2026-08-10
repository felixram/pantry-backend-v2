import z from "zod"
import { authedMutation } from "../../trpc.ts"
import { and, eq } from "drizzle-orm"
import { Location } from "../../../db/schema/location.ts"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"

export const updateLocationProcedure = authedMutation
  .input(
    z.object({
      id: z.uuid(),
      name: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      isActive: z.boolean().optional(),
      count_reminder_enabled: z.boolean().optional(),
      count_reminder_day: z.number().int().min(0).max(6).optional(),
      count_reminder_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      count_reminder_tz: z.string().optional(),
      count_designated_user_id: z.string().uuid().nullable().optional(),
      default_purchase_tax_rate_id: z.string().uuid().nullable().optional(),
      default_sales_tax_rate_id: z.string().uuid().nullable().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // MANAGER can only update their own location
    if (ctx.user!.role === ROLES.manager && input.id !== ctx.userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only update their own location",
      })
    }

    const location = await ctx.db.query.Location.findFirst({
      where: and(eq(Location.id, input.id), eq(Location.tenant_id, ctx.tenantId)),
    })

    if (!location || location.deletedAt)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Oops, we couldnt find this location.",
      })

    const updatedData: Record<string, any> = {}
    if (input.name !== undefined) updatedData.name = input.name
    if (input.address !== undefined) updatedData.address = input.address
    if (input.city !== undefined) updatedData.city = input.city
    if (input.postalCode !== undefined) updatedData.postalCode = input.postalCode
    if (input.isActive !== undefined) updatedData.active = input.isActive
    if (input.count_reminder_enabled !== undefined) updatedData.count_reminder_enabled = input.count_reminder_enabled
    if (input.count_reminder_day !== undefined) updatedData.count_reminder_day = input.count_reminder_day
    if (input.count_reminder_time !== undefined) updatedData.count_reminder_time = input.count_reminder_time
    if (input.count_reminder_tz !== undefined) updatedData.count_reminder_tz = input.count_reminder_tz
    if (input.count_designated_user_id !== undefined) updatedData.count_designated_user_id = input.count_designated_user_id
    if (input.default_purchase_tax_rate_id !== undefined) updatedData.default_purchase_tax_rate_id = input.default_purchase_tax_rate_id
    if (input.default_sales_tax_rate_id !== undefined) updatedData.default_sales_tax_rate_id = input.default_sales_tax_rate_id

    await ctx.db
      .update(Location)
      .set(updatedData)
      .where(and(eq(Location.id, input.id), eq(Location.tenant_id, ctx.tenantId)))

    return { message: "Location updated!" }
  })
