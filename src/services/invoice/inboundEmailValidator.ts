import { and, eq, isNull, isNotNull } from "drizzle-orm"
import { db } from "../../db/index.ts"
import { Location } from "../../db/schema/location.ts"
import { Supplier } from "../../db/schema/supplier.ts"
import { User } from "../../db/schema/users.ts"
import { TenantInvoiceConfig } from "../../db/schema/tenantInvoiceConfig.ts"
import { STATUS } from "../../types/user.ts"
import { logger } from "../../utils/logger.ts"

export interface InboundResolution {
  tenantId: string
  locationId: string
  config: {
    allowed_sender_domains: string[] | null
    auto_match_enabled: boolean
    require_po_match: boolean
  }
}

/**
 * Resolve an inbound email address to a tenant + location.
 *
 * Extracts the slug from the address (everything before @invoices.govantory.com)
 * and looks up the Location by `inbound_email_slug`.
 * Falls back to old TenantInvoiceConfig lookup for backward compatibility.
 */
export async function resolveInboundTenant(
  targetAddress: string
): Promise<InboundResolution | null> {
  const emailLower = targetAddress.toLowerCase()
  const slug = emailLower.split("@")[0]

  if (!slug) {
    logger.warn({ to: targetAddress }, "Could not extract slug from inbound email address")
    return null
  }

  // Primary: look up by location email slug
  const location = await db.query.Location.findFirst({
    where: and(
      eq(Location.inbound_email_slug, slug),
      isNull(Location.deletedAt)
    ),
  })

  if (location) {
    // Get tenant-level config for settings (sender domains, matching)
    const config = await db.query.TenantInvoiceConfig.findFirst({
      where: eq(TenantInvoiceConfig.tenant_id, location.tenant_id),
    })

    return {
      tenantId: location.tenant_id,
      locationId: location.id,
      config: {
        allowed_sender_domains: config?.allowed_sender_domains ?? null,
        auto_match_enabled: config?.auto_match_enabled ?? true,
        require_po_match: config?.require_po_match ?? false,
      },
    }
  }

  // Fallback: legacy TenantInvoiceConfig lookup
  const legacyConfig = await db.query.TenantInvoiceConfig.findFirst({
    where: eq(TenantInvoiceConfig.inbound_email_address, emailLower),
  })

  if (legacyConfig) {
    logger.info({ to: targetAddress }, "Resolved via legacy TenantInvoiceConfig (no location match)")
    return {
      tenantId: legacyConfig.tenant_id,
      locationId: legacyConfig.default_location_id ?? "",
      config: {
        allowed_sender_domains: legacyConfig.allowed_sender_domains,
        auto_match_enabled: legacyConfig.auto_match_enabled,
        require_po_match: legacyConfig.require_po_match,
      },
    }
  }

  logger.warn({ to: targetAddress, slug }, "No location or tenant config found for inbound email address")
  return null
}

/**
 * Check if the sender's domain is in the allowed whitelist.
 * Returns true if allowed or if no whitelist is configured.
 */
export function checkSenderDomainWhitelist(
  senderEmail: string,
  allowedDomains: string[] | null
): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true

  const senderDomain = senderEmail.split("@")[1]?.toLowerCase()
  const isAllowed = allowedDomains.some((d) => d.toLowerCase() === senderDomain)

  if (!isAllowed) {
    logger.warn({ senderEmail, allowedDomains }, "Sender domain not in whitelist")
  }

  return isAllowed
}

/**
 * Validate that the sender is a known supplier domain or an active org user.
 */
export async function validateSender(
  senderEmail: string,
  tenantId: string
): Promise<{ isSupplierDomain: boolean; isOrgUser: boolean }> {
  const senderEmailLower = senderEmail.toLowerCase()
  const senderDomain = senderEmailLower.split("@")[1]?.toLowerCase()

  // Check if sender is from a known active supplier's domain
  const suppliers = await db
    .select({ email: Supplier.email })
    .from(Supplier)
    .where(
      and(
        eq(Supplier.tenant_id, tenantId),
        isNull(Supplier.deletedAt),
        isNotNull(Supplier.email)
      )
    )

  const supplierDomains = new Set(
    suppliers
      .map((s) => s.email?.split("@")[1]?.toLowerCase())
      .filter(Boolean)
  )
  const isSupplierDomain = senderDomain ? supplierDomains.has(senderDomain) : false

  // If not a supplier domain, check if sender is an active org user (exact email)
  let isOrgUser = false
  if (!isSupplierDomain) {
    const knownUser = await db.query.User.findFirst({
      where: and(
        eq(User.tenant_id, tenantId),
        eq(User.email, senderEmailLower),
        eq(User.status, STATUS.active),
        isNull(User.deletedAt)
      ),
    })
    isOrgUser = !!knownUser
  }

  if (!isSupplierDomain && !isOrgUser) {
    logger.warn({ senderEmail, tenantId }, "Sender not recognized — not a supplier domain or org user")
  }

  return { isSupplierDomain, isOrgUser }
}
