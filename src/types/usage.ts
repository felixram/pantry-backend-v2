// USAGE EVENT TYPES — one row per metered call to a paid third-party
// service, written by src/services/usage/recordUsageEvent.ts. See that file
// for the quantity unit convention per type.
export const USAGE_EVENT_TYPE = {
  ai_invoice_extraction: "AI_INVOICE_EXTRACTION",
  email_sent: "EMAIL_SENT",
  file_storage: "FILE_STORAGE",
} as const

export type UsageEventType = (typeof USAGE_EVENT_TYPE)[keyof typeof USAGE_EVENT_TYPE]
