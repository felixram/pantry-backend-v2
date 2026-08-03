import { and, eq, isNull } from "drizzle-orm"
import { TenantInvoiceConfig } from "../../../db/schema/tenantInvoiceConfig.ts"
import { Location } from "../../../db/schema/location.ts"
import { adminProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"

export const getInvoiceConfigProcedure = adminProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Tenant context required",
    })
  }

  const config = await ctx.db.query.TenantInvoiceConfig.findFirst({
    where: eq(TenantInvoiceConfig.tenant_id, ctx.tenantId),
  })

  // Get all locations with their email slugs
  const locations = await ctx.db
    .select({
      id: Location.id,
      name: Location.name,
      inbound_email_slug: Location.inbound_email_slug,
    })
    .from(Location)
    .where(
      and(
        eq(Location.tenant_id, ctx.tenantId),
        isNull(Location.deletedAt),
        eq(Location.active, true)
      )
    )

  const locationEmails = locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    emailSlug: loc.inbound_email_slug,
    emailAddress: loc.inbound_email_slug
      ? `${loc.inbound_email_slug}@invoices.govantory.com`
      : null,
  }))

  return {
    inboundEmailAddress: config?.inbound_email_address ?? null,
    autoMatchEnabled: config?.auto_match_enabled ?? true,
    requirePoMatch: config?.require_po_match ?? false,
    defaultLocationId: config?.default_location_id ?? null,
    allowedSenderDomains: config?.allowed_sender_domains ?? [],
    locationEmails,
  }
})
