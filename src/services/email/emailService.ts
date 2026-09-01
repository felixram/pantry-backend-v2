import {
  getInvitationEmailHtml,
  getInvitationEmailText,
} from "./templates/invitation.ts"
import {
  getPasswordResetEmailHtml,
  getPasswordResetEmailText,
} from "./templates/passwordReset.ts"
import {
  getInventoryCountReminderHtml,
  getInventoryCountReminderText,
} from "./templates/inventoryCountReminder.ts"
import {
  getInvoiceReceivedEmailHtml,
  getInvoiceReceivedEmailText,
} from "./templates/invoiceReceived.ts"
import {
  getInvoiceBounceEmailHtml,
  getInvoiceBounceEmailText,
} from "./templates/invoiceBounce.ts"
import {
  getInvoiceAcknowledgmentEmailHtml,
  getInvoiceAcknowledgmentEmailText,
} from "./templates/invoiceAcknowledgment.ts"
import { db } from "../../db/index.ts"
import { User } from "../../db/schema/users.ts"
import { Tenant } from "../../db/schema/tenant.ts"
import { eq, and, isNull } from "drizzle-orm"
import { hasElevatedRole } from "../../types/user.ts"
import { STATUS } from "../../types/user.ts"
import { logger } from "../../utils/logger.ts"
import { enqueueEmail } from "./enqueueEmail.ts"
import { EMAIL_TYPE } from "../../types/email.ts"

// These functions no longer talk to Resend directly — they render a
// template and drop one row on the email_queue. The worker
// (emailQueueWorker.ts) sends it within ~1s, paced under the provider's
// request limit, with retries. `success` here means "accepted onto the
// queue", not "delivered".
interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

const QUEUED: SendEmailResult = { success: true, messageId: "queued" }
const QUEUE_FAILED: SendEmailResult = { success: false, error: "Failed to queue email" }

export async function sendInvitationEmail(params: {
  to: string
  userName: string
  inviteUrl: string
  organizationName: string
  expiresAt: Date
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, userName, inviteUrl, organizationName, expiresAt, tenantId } = params

  const { queued } = await enqueueEmail({
    to,
    emailType: EMAIL_TYPE.invitation,
    tenantId,
    subject: `You're invited to join ${organizationName} on Vantory`,
    html: getInvitationEmailHtml({ userName, inviteUrl, organizationName, expiresAt }),
    text: getInvitationEmailText({ userName, inviteUrl, organizationName, expiresAt }),
  })
  return queued ? QUEUED : QUEUE_FAILED
}

export async function sendPasswordResetEmail(params: {
  to: string
  userName: string
  resetUrl: string
  expiresAt: Date
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, userName, resetUrl, expiresAt, tenantId } = params

  const { queued } = await enqueueEmail({
    to,
    emailType: EMAIL_TYPE.password_reset,
    tenantId,
    subject: "Reset your Vantory password",
    html: getPasswordResetEmailHtml({ userName, resetUrl, expiresAt }),
    text: getPasswordResetEmailText({ userName, resetUrl, expiresAt }),
  })
  return queued ? QUEUED : QUEUE_FAILED
}

export async function sendInventoryCountReminder(params: {
  to: string
  userName: string
  magicLink: string
  orgName: string
  weekIdentifier: string
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, userName, magicLink, orgName, weekIdentifier, tenantId } = params

  const { queued } = await enqueueEmail({
    to,
    emailType: EMAIL_TYPE.count_reminder,
    tenantId,
    // One reminder per (recipient, ISO week) — the cron re-enqueues every
    // hour but this key makes every attempt after the first a no-op.
    idempotencyKey: `${EMAIL_TYPE.count_reminder}:${weekIdentifier}:${to.toLowerCase()}`,
    subject: `Time for your weekly inventory count – ${weekIdentifier}`,
    html: getInventoryCountReminderHtml({ userName, magicLink, orgName, weekIdentifier }),
    text: getInventoryCountReminderText({ userName, magicLink, orgName, weekIdentifier }),
  })
  return queued ? QUEUED : QUEUE_FAILED
}

export async function sendInvoiceBounceEmail(params: {
  to: string
  inboundAddress: string
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, inboundAddress, tenantId } = params

  const { queued } = await enqueueEmail({
    to,
    emailType: EMAIL_TYPE.invoice_bounce,
    tenantId,
    subject: "Invoice not processed — sender not recognized",
    html: getInvoiceBounceEmailHtml({ senderEmail: to, inboundAddress }),
    text: getInvoiceBounceEmailText({ senderEmail: to, inboundAddress }),
  })
  return queued ? QUEUED : QUEUE_FAILED
}

/**
 * Acknowledgment back to the original sender confirming receipt.
 */
export async function sendInvoiceAcknowledgmentEmail(params: {
  to: string
  senderName: string
  itemCount: number
  receivedAt: Date
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, senderName, itemCount, receivedAt, tenantId } = params

  const receivedAtStr = receivedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const { queued } = await enqueueEmail({
    to,
    emailType: EMAIL_TYPE.invoice_acknowledgment,
    tenantId,
    subject: "Your invoice has been received",
    html: getInvoiceAcknowledgmentEmailHtml({ senderName, itemCount, receivedAt: receivedAtStr }),
    text: getInvoiceAcknowledgmentEmailText({ senderName, itemCount, receivedAt: receivedAtStr }),
  })
  return queued ? QUEUED : QUEUE_FAILED
}

/**
 * Fan-out an "invoice received" notification to every active admin/manager
 * in the tenant — one queue row each, deduped per (invoice, recipient).
 */
export async function sendInvoiceReceivedNotification(params: {
  tenantId: string
  invoiceId: string
  supplierName: string
  invoiceTotal: number
  itemCount: number
  hasUnmatchedItems: boolean
  hasDiscrepancies: boolean
  matchedSupplier: boolean
  currency?: string
}): Promise<void> {
  const {
    tenantId,
    invoiceId,
    supplierName,
    invoiceTotal,
    itemCount,
    hasUnmatchedItems,
    hasDiscrepancies,
    currency,
  } = params

  const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173"
  const reviewUrl = `${clientUrl}/invoices/${invoiceId}`

  const users = await db
    .select({ email: User.email, name: User.name, role: User.role })
    .from(User)
    .innerJoin(Tenant, eq(User.tenant_id, Tenant.id))
    .where(
      and(
        eq(User.tenant_id, tenantId),
        eq(User.status, STATUS.active),
        isNull(User.deletedAt)
      )
    )

  const elevatedUsers = users.filter((u) => hasElevatedRole(u.role))
  if (elevatedUsers.length === 0) return

  const templateParams = {
    supplierName,
    invoiceTotal,
    itemCount,
    hasUnmatchedItems,
    hasDiscrepancies,
    reviewUrl,
    currency,
  }
  const html = getInvoiceReceivedEmailHtml(templateParams)
  const text = getInvoiceReceivedEmailText(templateParams)
  const subject = `New invoice received from ${supplierName}`

  const results = await Promise.all(
    elevatedUsers.map((user) =>
      enqueueEmail({
        to: user.email,
        emailType: EMAIL_TYPE.invoice_received,
        tenantId,
        idempotencyKey: `${EMAIL_TYPE.invoice_received}:${invoiceId}:${user.email.toLowerCase()}`,
        subject,
        html,
        text,
      })
    )
  )

  logger.info(
    { invoiceId, recipients: elevatedUsers.length, queued: results.filter((r) => r.queued).length },
    "invoice-received notifications enqueued"
  )
}
