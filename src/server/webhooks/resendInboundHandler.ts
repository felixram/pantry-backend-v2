import type { Request, Response } from "express"
import { verifyWebhookSignature } from "../../services/invoice/webhookSignature.ts"
import {
  resolveInboundTenant,
  checkSenderDomainWhitelist,
  validateSender,
} from "../../services/invoice/inboundEmailValidator.ts"
import {
  checkDuplicateEmail,
  ingestInvoiceAttachments,
} from "../../services/invoice/invoiceIngestion.ts"
import { sendInvoiceBounceEmail } from "../../services/email/emailService.ts"
import { getResendClient } from "../../services/email/resendClient.ts"
import { logger } from "../../utils/logger.ts"
import type { ResendInboundWebhookEvent } from "../../types/invoice.ts"

/**
 * Parse a bare email address from an RFC 5322 formatted string.
 * "Name <user@example.com>" → "user@example.com"
 * "user@example.com"         → "user@example.com"
 */
function parseEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1]! : raw).trim().toLowerCase()
}

/**
 * Parse the display name from an RFC 5322 formatted string.
 * "Name <user@example.com>" → "Name"
 * "user@example.com"         → "user@example.com"
 */
function parseDisplayName(raw: string): string {
  const match = raw.match(/^(.+?)\s*<[^>]+>$/)
  return match ? match[1]!.trim().replace(/^"|"$/g, "") : raw.trim()
}

/**
 * Fetch the original sender and recipient from the Resend API.
 * The webhook `from` and `to` both show the Resend inbound address
 * (inbound@talapti.resend.app). The real values are in the email headers.
 */
async function fetchOriginalHeaders(emailId: string): Promise<{
  from: string | null
  fromRaw: string | null
  to: string | null
}> {
  const resend = getResendClient()
  if (!resend) return { from: null, fromRaw: null, to: null }

  try {
    const { data, error } = await resend.emails.receiving.get(emailId)
    if (error || !data) {
      logger.error({ error, emailId }, "Failed to fetch email from Resend")
      return { from: null, fromRaw: null, to: null }
    }

    const email = data as any
    const headerFrom = email.headers?.from as string | undefined
    const headerTo = email.headers?.to as string | undefined

    logger.info({ headerFrom, headerTo, emailId }, "Resolved original headers from Resend API")

    return {
      from: headerFrom ? parseEmailAddress(headerFrom) : null,
      fromRaw: headerFrom ?? null,
      to: headerTo ? parseEmailAddress(headerTo) : null,
    }
  } catch (err) {
    logger.error({ error: err, emailId }, "Error fetching email from Resend")
    return { from: null, fromRaw: null, to: null }
  }
}

export async function handleResendInbound(req: Request, res: Response) {
  logger.info("Resend inbound webhook received")

  // The body arrives as a raw Buffer (express.raw middleware) for signature verification
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : req.body

  // 1. Verify webhook signature (Resend uses Svix headers)
  if (!verifyWebhookSignature(rawBody, {
    "svix-id": req.headers["svix-id"] as string | undefined,
    "svix-timestamp": req.headers["svix-timestamp"] as string | undefined,
    "svix-signature": req.headers["svix-signature"] as string | undefined,
  })) {
    return res.status(401).json({ error: "Invalid webhook signature" })
  }

  try {
    const event = (typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody) as ResendInboundWebhookEvent
    const { from, to, subject, attachments, message_id, email_id } = event.data

    // The webhook `from` and `to` are both the Resend inbound address
    // (inbound@talapti.resend.app). Fetch the real values from email headers.
    const originalHeaders = await fetchOriginalHeaders(email_id)

    const fromRaw = typeof from === "string" ? from : ""
    const fromEmail = originalHeaders.from ?? parseEmailAddress(fromRaw)
    const fromName = originalHeaders.fromRaw
      ? parseDisplayName(originalHeaders.fromRaw)
      : parseDisplayName(fromRaw)

    const targetAddress = originalHeaders.to ?? (to[0] ? parseEmailAddress(to[0]) : undefined)

    logger.info({ webhookFrom: from, resolvedFrom: fromEmail, webhookTo: to[0], resolvedTo: targetAddress }, "Resolved email addresses")

    if (!targetAddress) {
      return res.status(400).json({ error: "No recipient address" })
    }

    // 2. Map to tenant + location
    const resolution = await resolveInboundTenant(targetAddress)
    if (!resolution) {
      return res.status(404).json({ error: "Unknown inbound address" })
    }

    // 3. Validate sender domain whitelist
    if (!checkSenderDomainWhitelist(fromEmail, resolution.config.allowed_sender_domains)) {
      return res.status(403).json({ error: "Sender domain not allowed" })
    }

    // 4. Validate sender is known supplier or org user
    const { isSupplierDomain, isOrgUser } = await validateSender(
      fromEmail,
      resolution.tenantId
    )
    if (!isSupplierDomain && !isOrgUser) {
      sendInvoiceBounceEmail({ to: fromEmail, inboundAddress: targetAddress, tenantId: resolution.tenantId }).catch(() => {})
      return res.status(200).json({ success: true, bounced: true })
    }

    // 5. Deduplication check (always uses email_id which is always present)
    const { duplicate, existingId } = await checkDuplicateEmail(
      email_id,
      resolution.tenantId
    )
    if (duplicate) {
      return res.json({ success: true, duplicate: true, invoiceId: existingId })
    }

    // 6. Respond immediately to prevent Svix retries, then process async
    res.json({ success: true, accepted: true })

    // Fire-and-forget: ingest attachments, create invoice records, trigger processing
    ingestInvoiceAttachments({
      tenantId: resolution.tenantId,
      locationId: resolution.locationId || null,
      fromEmail,
      fromName,
      subject: subject || null,
      messageId: message_id || null,
      emailId: email_id,
      attachments,
    })
      .then((invoiceIds) => {
        logger.info(
          { from: fromEmail, to: targetAddress, attachments: attachments?.length ?? 0, invoiceIds },
          "Inbound invoice email processed"
        )
      })
      .catch((err) => {
        logger.error({ error: err, from: fromEmail, to: targetAddress }, "Inbound invoice ingestion failed")
      })
  } catch (error) {
    logger.error({ error }, "Resend inbound webhook failed")
    return res.status(500).json({ error: "Internal server error" })
  }
}
