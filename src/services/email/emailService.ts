import { getResendClient, getFromEmail } from "./resendClient.ts"
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
import { recordUsageEvent } from "../usage/recordUsageEvent.ts"
import { USAGE_EVENT_TYPE } from "../../types/usage.ts"

interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendInvitationEmail(params: {
  to: string
  userName: string
  inviteUrl: string
  organizationName: string
  expiresAt: Date
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, userName, inviteUrl, organizationName, expiresAt, tenantId } = params

  const resend = getResendClient()
  const fromEmail = getFromEmail()

  // Development fallback: log to console if no API key
  if (!resend) {
    console.log({
      type: "email_invitation_dev",
      to,
      userName,
      inviteUrl,
      message: "Email would be sent (no RESEND_API_KEY configured)",
    })
    return { success: true, messageId: "dev-mode" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `Vantory <${fromEmail}>`,
      to: [to],
      subject: `You're invited to join ${organizationName} on Vantory`,
      html: getInvitationEmailHtml({
        userName,
        inviteUrl,
        organizationName,
        expiresAt,
      }),
      text: getInvitationEmailText({
        userName,
        inviteUrl,
        organizationName,
        expiresAt,
      }),
    })

    if (error) {
      console.error({ type: "email_invitation_error", error, to })
      return { success: false, error: error.message }
    }

    console.log({ type: "email_invitation_sent", messageId: data?.id, to })
    if (tenantId) {
      await recordUsageEvent({
        tenantId,
        eventType: USAGE_EVENT_TYPE.email_sent,
        quantity: 1,
        metadata: { kind: "invitation", messageId: data?.id },
      })
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error({ type: "email_invitation_exception", error: err, to })
    return { success: false, error: "Failed to send email" }
  }
}

export async function sendPasswordResetEmail(params: {
  to: string
  userName: string
  resetUrl: string
  expiresAt: Date
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, userName, resetUrl, expiresAt, tenantId } = params

  const resend = getResendClient()
  const fromEmail = getFromEmail()

  if (!resend) {
    console.log({
      type: "email_password_reset_dev",
      to,
      resetUrl,
      message: "Email would be sent (no RESEND_API_KEY configured)",
    })
    return { success: true, messageId: "dev-mode" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `Vantory <${fromEmail}>`,
      to: [to],
      subject: "Reset your Vantory password",
      html: getPasswordResetEmailHtml({ userName, resetUrl, expiresAt }),
      text: getPasswordResetEmailText({ userName, resetUrl, expiresAt }),
    })

    if (error) {
      console.error({ type: "email_password_reset_error", error, to })
      return { success: false, error: error.message }
    }

    console.log({ type: "email_password_reset_sent", messageId: data?.id, to })
    if (tenantId) {
      await recordUsageEvent({
        tenantId,
        eventType: USAGE_EVENT_TYPE.email_sent,
        quantity: 1,
        metadata: { kind: "password_reset", messageId: data?.id },
      })
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error({ type: "email_password_reset_exception", error: err, to })
    return { success: false, error: "Failed to send email" }
  }
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

  const resend = getResendClient()
  const fromEmail = getFromEmail()

  if (!resend) {
    console.log({
      type: "email_inventory_reminder_dev",
      to,
      magicLink,
      weekIdentifier,
      message: "Email would be sent (no RESEND_API_KEY configured)",
    })
    return { success: true, messageId: "dev-mode" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `Vantory <${fromEmail}>`,
      to: [to],
      subject: `Time for your weekly inventory count – ${weekIdentifier}`,
      html: getInventoryCountReminderHtml({ userName, magicLink, orgName, weekIdentifier }),
      text: getInventoryCountReminderText({ userName, magicLink, orgName, weekIdentifier }),
    })

    if (error) {
      console.error({ type: "email_inventory_reminder_error", error, to })
      return { success: false, error: error.message }
    }

    console.log({ type: "email_inventory_reminder_sent", messageId: data?.id, to })
    if (tenantId) {
      await recordUsageEvent({
        tenantId,
        eventType: USAGE_EVENT_TYPE.email_sent,
        quantity: 1,
        metadata: { kind: "inventory_count_reminder", messageId: data?.id },
      })
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error({ type: "email_inventory_reminder_exception", error: err, to })
    return { success: false, error: "Failed to send email" }
  }
}

export async function sendInvoiceBounceEmail(params: {
  to: string
  inboundAddress: string
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, inboundAddress, tenantId } = params

  const resend = getResendClient()
  const fromEmail = getFromEmail()

  if (!resend) {
    console.log({
      type: "email_invoice_bounce_dev",
      to,
      inboundAddress,
      message: "Email would be sent (no RESEND_API_KEY configured)",
    })
    return { success: true, messageId: "dev-mode" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `Vantory <${fromEmail}>`,
      to: [to],
      subject: "Invoice not processed — sender not recognized",
      html: getInvoiceBounceEmailHtml({ senderEmail: to, inboundAddress }),
      text: getInvoiceBounceEmailText({ senderEmail: to, inboundAddress }),
    })

    if (error) {
      console.error({ type: "email_invoice_bounce_error", error, to })
      return { success: false, error: error.message }
    }

    console.log({ type: "email_invoice_bounce_sent", messageId: data?.id, to })
    if (tenantId) {
      await recordUsageEvent({
        tenantId,
        eventType: USAGE_EVENT_TYPE.email_sent,
        quantity: 1,
        metadata: { kind: "invoice_bounce", messageId: data?.id },
      })
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error({ type: "email_invoice_bounce_exception", error: err, to })
    return { success: false, error: "Failed to send email" }
  }
}

/**
 * Send acknowledgment email back to the original sender confirming receipt.
 */
export async function sendInvoiceAcknowledgmentEmail(params: {
  to: string
  senderName: string
  itemCount: number
  receivedAt: Date
  tenantId?: string
}): Promise<SendEmailResult> {
  const { to, senderName, itemCount, receivedAt, tenantId } = params

  const resend = getResendClient()
  const fromEmail = getFromEmail()

  if (!resend) {
    console.log({
      type: "email_invoice_ack_dev",
      to,
      senderName,
      itemCount,
      message: "Email would be sent (no RESEND_API_KEY configured)",
    })
    return { success: true, messageId: "dev-mode" }
  }

  try {
    const receivedAtStr = receivedAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

    const { data, error } = await resend.emails.send({
      from: `Vantory <${fromEmail}>`,
      to: [to],
      subject: "Your invoice has been received",
      html: getInvoiceAcknowledgmentEmailHtml({ senderName, itemCount, receivedAt: receivedAtStr }),
      text: getInvoiceAcknowledgmentEmailText({ senderName, itemCount, receivedAt: receivedAtStr }),
    })

    if (error) {
      console.error({ type: "email_invoice_ack_error", error, to })
      return { success: false, error: error.message }
    }

    console.log({ type: "email_invoice_ack_sent", messageId: data?.id, to })
    if (tenantId) {
      await recordUsageEvent({
        tenantId,
        eventType: USAGE_EVENT_TYPE.email_sent,
        quantity: 1,
        metadata: { kind: "invoice_acknowledgment", messageId: data?.id },
      })
    }
    return { success: true, messageId: data?.id }
  } catch (err) {
    console.error({ type: "email_invoice_ack_exception", error: err, to })
    return { success: false, error: "Failed to send email" }
  }
}

/**
 * Send invoice received notification to all admin/manager users in the tenant.
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

  // Fetch all admin/manager users in this tenant
  const users = await db
    .select({
      email: User.email,
      name: User.name,
      role: User.role,
    })
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

  const resend = getResendClient()
  const fromEmail = getFromEmail()

  const templateParams = {
    supplierName,
    invoiceTotal,
    itemCount,
    hasUnmatchedItems,
    hasDiscrepancies,
    reviewUrl,
    currency,
  }

  await Promise.all(
    elevatedUsers.map(async (user) => {
      if (!resend) {
        console.log({
          type: "email_invoice_received_dev",
          to: user.email,
          supplierName,
          invoiceTotal,
          message: "Email would be sent (no RESEND_API_KEY configured)",
        })
        return
      }

      try {
        const { data } = await resend.emails.send({
          from: `Vantory <${fromEmail}>`,
          to: [user.email],
          subject: `New invoice received from ${supplierName}`,
          html: getInvoiceReceivedEmailHtml(templateParams),
          text: getInvoiceReceivedEmailText(templateParams),
        })
        await recordUsageEvent({
          tenantId,
          eventType: USAGE_EVENT_TYPE.email_sent,
          quantity: 1,
          metadata: { kind: "invoice_received_notification", messageId: data?.id },
        })
      } catch (err) {
        console.error({ type: "email_invoice_received_error", error: err, to: user.email })
      }
    })
  )
}
