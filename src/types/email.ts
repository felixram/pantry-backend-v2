// Outbound email categories. The value is stored on email_queue.email_type
// and echoed into the usage-event metadata `kind`. Keep in sync with
// EMAIL_PRIORITY below.
export const EMAIL_TYPE = {
  invitation: "INVITATION",
  password_reset: "PASSWORD_RESET",
  count_reminder: "COUNT_REMINDER",
  invoice_received: "INVOICE_RECEIVED",
  invoice_acknowledgment: "INVOICE_ACKNOWLEDGMENT",
  invoice_bounce: "INVOICE_BOUNCE",
} as const

export type EmailType = (typeof EMAIL_TYPE)[keyof typeof EMAIL_TYPE]

// Lower drains first. Someone is watching a spinner for a password reset or
// an invite; a fan-out notification can wait a few seconds behind them.
export const EMAIL_PRIORITY: Record<EmailType, number> = {
  [EMAIL_TYPE.password_reset]: 10,
  [EMAIL_TYPE.invitation]: 10,
  [EMAIL_TYPE.count_reminder]: 20,
  [EMAIL_TYPE.invoice_bounce]: 40,
  [EMAIL_TYPE.invoice_received]: 50,
  [EMAIL_TYPE.invoice_acknowledgment]: 50,
}
