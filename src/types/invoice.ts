export const INVOICE_STATUS = {
  pending: "PENDING",
  processing: "PROCESSING",
  extracted: "EXTRACTED",
  matched: "MATCHED",
  review: "REVIEW",
  confirmed: "CONFIRMED",
  applied: "APPLIED",
  failed: "FAILED",
  rejected: "REJECTED",
} as const

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS]

// Terminal states that cannot transition further
export const INVOICE_TERMINAL_STATES = [
  INVOICE_STATUS.applied,
  INVOICE_STATUS.rejected,
] as const

// States that require admin review
export const INVOICE_REVIEW_STATES = [
  INVOICE_STATUS.review,
  INVOICE_STATUS.matched,
] as const

/** Resend inbound webhook event wrapper */
export interface ResendInboundWebhookEvent {
  type: "email.received"
  created_at: string
  data: InboundEmailData
}

/** The actual email data inside the Resend webhook event */
export interface InboundEmailData {
  email_id: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject?: string
  message_id?: string
  created_at: string
  attachments?: Array<{
    id: string
    filename: string
    content_type: string
    content_disposition: string
    content_id: string | null
  }>
}
