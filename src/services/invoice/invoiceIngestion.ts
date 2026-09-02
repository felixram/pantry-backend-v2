import { and, eq } from "drizzle-orm"
import { db } from "../../db/index.ts"
import { Invoice } from "../../db/schema/invoice.ts"
import { INVOICE_STATUS } from "../../types/invoice.ts"
import { uploadInvoiceFile } from "../storage/r2Client.ts"
import { processInvoice } from "./invoiceProcessor.ts"
import { logger } from "../../utils/logger.ts"
import { getResendClient } from "../email/resendClient.ts"
import type { InboundEmailData } from "../../types/invoice.ts"

/**
 * Whether any invoice already exists for this inbound email (by
 * resend_email_id). A *signal*, not a gate — ingestInvoiceAttachments is
 * idempotent per attachment, so a re-delivered webhook resumes and fills
 * in any attachments that weren't created the first time. Uses email_id
 * (always present) rather than message_id (optional).
 */
export async function checkDuplicateEmail(
  emailId: string,
  tenantId: string
): Promise<{ duplicate: boolean; existingId?: string }> {
  const existing = await db.query.Invoice.findFirst({
    where: and(
      eq(Invoice.resend_email_id, emailId),
      eq(Invoice.tenant_id, tenantId)
    ),
  })

  if (existing) {
    logger.info({ emailId }, "Duplicate invoice email, skipping")
    return { duplicate: true, existingId: existing.id }
  }

  return { duplicate: false }
}

/**
 * Fetch attachment content from Resend API.
 * Returns the file as a Buffer, or null if fetch fails.
 */
async function fetchAttachmentContent(
  emailId: string,
  attachmentId: string
): Promise<Buffer | null> {
  const resend = getResendClient()
  if (!resend) {
    logger.warn("No Resend client — cannot fetch attachment")
    return null
  }

  try {
    const { data, error } = await resend.emails.receiving.attachments.get({
      emailId,
      id: attachmentId,
    })

    if (error || !data) {
      logger.error({ error, emailId, attachmentId }, "Failed to fetch attachment from Resend")
      return null
    }

    // Resend returns metadata with a signed download_url, not the content directly
    const downloadUrl = (data as any).download_url
    if (!downloadUrl) {
      logger.error({ emailId, attachmentId }, "No download_url in Resend attachment response")
      return null
    }

    const response = await fetch(downloadUrl)
    if (!response.ok) {
      logger.error({ emailId, attachmentId, status: response.status }, "Failed to download attachment from Resend URL")
      return null
    }

    return Buffer.from(await response.arrayBuffer())
  } catch (err) {
    logger.error({ error: err, emailId, attachmentId }, "Error fetching attachment from Resend")
    return null
  }
}

/**
 * Ingest attachments from an inbound email: create invoice records,
 * upload files to R2, and trigger async processing.
 */
export async function ingestInvoiceAttachments(params: {
  tenantId: string
  locationId: string | null
  fromEmail: string
  fromName: string
  subject: string | null
  messageId: string | null
  emailId: string
  attachments: InboundEmailData["attachments"]
}): Promise<string[]> {
  const { tenantId, locationId, fromEmail, fromName, subject, messageId, emailId, attachments } = params
  const invoiceIds: string[] = []

  const fileAttachments =
    attachments?.filter(
      (a) =>
        a.content_type === "application/pdf" ||
        a.content_type.startsWith("image/")
    ) ?? []

  // No suitable attachments — create a single failed invoice record. The
  // "__none__" sentinel keeps a re-delivered webhook from stacking
  // duplicate FAILED rows (real attachment ids never look like this).
  if (fileAttachments.length === 0) {
    const [invoice] = await db
      .insert(Invoice)
      .values({
        tenant_id: tenantId,
        location_id: locationId,
        from_email: fromEmail,
        from_name: fromName,
        subject,
        received_at: new Date(),
        resend_message_id: messageId,
        resend_email_id: emailId,
        resend_attachment_id: "__none__",
        status: INVOICE_STATUS.failed,
        processing_error: "No PDF or image attachment found in email",
      })
      .onConflictDoNothing({
        target: [Invoice.tenant_id, Invoice.resend_email_id, Invoice.resend_attachment_id],
      })
      .returning()

    if (invoice) invoiceIds.push(invoice.id)
    return invoiceIds
  }

  // One invoice row per attachment. A multi-page invoice is a single
  // (multi-page) file = one attachment = one row — pages are never split,
  // and separate attachments are never merged; the reviewer resolves a
  // split-across-files invoice, helped by the same-invoice-number nudge.
  for (const attachment of fileAttachments) {
    let invoice: typeof Invoice.$inferSelect | undefined
    try {
      ;[invoice] = await db
        .insert(Invoice)
        .values({
          tenant_id: tenantId,
          location_id: locationId,
          from_email: fromEmail,
          from_name: fromName,
          subject,
          received_at: new Date(),
          resend_message_id: messageId,
          resend_email_id: emailId,
          resend_attachment_id: attachment.id,
          original_file_name: attachment.filename,
          original_file_type: attachment.content_type,
          status: INVOICE_STATUS.pending,
        })
        // Re-delivered webhook / redeploy mid-batch: skip attachments
        // already ingested, keep going for the rest.
        .onConflictDoNothing({
          target: [Invoice.tenant_id, Invoice.resend_email_id, Invoice.resend_attachment_id],
        })
        .returning()
    } catch (err) {
      // An unexpected insert failure (DB blip) on one attachment must not
      // abort the others.
      logger.error(
        { error: err, emailId, attachmentId: attachment.id },
        "Failed to create invoice row for attachment"
      )
      continue
    }

    if (!invoice) {
      // Already ingested on an earlier delivery — surface its id so the
      // webhook log stays accurate, then leave its processing alone.
      const existing = await db.query.Invoice.findFirst({
        where: and(
          eq(Invoice.tenant_id, tenantId),
          eq(Invoice.resend_email_id, emailId),
          eq(Invoice.resend_attachment_id, attachment.id)
        ),
        columns: { id: true },
      })
      if (existing) {
        invoiceIds.push(existing.id)
        logger.info(
          { emailId, attachmentId: attachment.id, invoiceId: existing.id },
          "Attachment already ingested — skipping"
        )
      }
      continue
    }

    invoiceIds.push(invoice.id)

    // uploadInvoiceFile can throw (e.g. an R2 network/credential error) —
    // wrapped so one bad attachment can't abort the rest of the batch and
    // can't leave this invoice stuck at PENDING with no explanation and no
    // way to retry (retryInvoice only surfaces FAILED invoices).
    try {
      // Fetch attachment content from Resend API
      const buffer = await fetchAttachmentContent(emailId, attachment.id)

      if (buffer) {
        const fileKey = await uploadInvoiceFile(
          tenantId,
          invoice.id,
          buffer,
          attachment.content_type,
          attachment.filename
        )

        if (fileKey) {
          await db
            .update(Invoice)
            .set({ original_file_url: fileKey })
            .where(and(eq(Invoice.id, invoice.id), eq(Invoice.tenant_id, tenantId)))
        }
      } else {
        logger.warn({ invoiceId: invoice.id, attachmentId: attachment.id }, "Could not fetch attachment content")
      }

      // Trigger async processing (fire-and-forget). If original_file_url
      // never got set (buffer/upload failed above), processInvoice's own
      // download step fails fast and marks the invoice FAILED — still a
      // clean, retryable terminal state.
      processInvoice(invoice.id, tenantId).catch((err) => {
        logger.error({ error: err, invoiceId: invoice.id }, "Background invoice processing failed")
      })
    } catch (err) {
      logger.error({ error: err, invoiceId: invoice.id, attachmentId: attachment.id }, "Failed to prepare invoice attachment for processing")
      await db
        .update(Invoice)
        .set({
          status: INVOICE_STATUS.failed,
          processing_error: err instanceof Error ? err.message : String(err),
        })
        .where(and(eq(Invoice.id, invoice.id), eq(Invoice.tenant_id, tenantId)))
    }
  }

  return invoiceIds
}
