import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { Location } from "../../../db/schema/location.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { TRPCError } from "@trpc/server"
import { ROLES } from "../../../types/user.ts"
import { generateLocationEmailSlug } from "../../../utils/slugify.ts"

export const createLocationProcedure = adminMutation
  .input(
    z.object({
      name: z.string(),
      address: z.string(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      place_id: z.string().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    // Only full admins can create locations
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can create locations",
      })
    }

    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Get tenant slug for email slug generation
    const tenant = await ctx.db.query.Tenant.findFirst({
      where: eq(Tenant.id, ctx.tenantId),
    })

    if (!tenant) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Tenant not found",
      })
    }

    // Generate unique email slug
    let emailSlug = generateLocationEmailSlug(tenant.slug, input.name)

    // Handle uniqueness collisions by appending a numeric suffix
    let suffix = 1
    while (true) {
      const existing = await ctx.db.query.Location.findFirst({
        where: eq(Location.inbound_email_slug, emailSlug),
      })
      if (!existing) break
      suffix++
      emailSlug = `${generateLocationEmailSlug(tenant.slug, input.name)}-${suffix}`
    }

    const [location] = await ctx.db
      .insert(Location)
      .values({
        ...input,
        inbound_email_slug: emailSlug,
        tenant_id: ctx.tenantId,
      })
      .returning()
    return { message: "Location successfully created!", location }
  })
