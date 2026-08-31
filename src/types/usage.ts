// USAGE EVENT TYPES — one row per metered call to a paid third-party
// service, written by src/services/usage/recordUsageEvent.ts. See that file
// for the quantity unit convention per type.
export const USAGE_EVENT_TYPE = {
  ai_invoice_extraction: "AI_INVOICE_EXTRACTION",
  email_sent: "EMAIL_SENT",
  file_storage: "FILE_STORAGE",
  // Outcome signals for AI extraction reliability — exactly one row per
  // extractInvoiceData() call (quantity 1), independent of the per-attempt
  // token rows above. Consumed by the owner console's AI-reliability panel
  // (controllers/ownerControllers/aiReliability.ts), never billed.
  ai_invoice_extraction_ok: "AI_INVOICE_EXTRACTION_OK",
  ai_invoice_extraction_failed: "AI_INVOICE_EXTRACTION_FAILED",
} as const

export type UsageEventType = (typeof USAGE_EVENT_TYPE)[keyof typeof USAGE_EVENT_TYPE]

// The two outcome event types above — grouped so callers that report on
// reliability (not billing) can filter the ledger without restating the
// literals.
export const AI_EXTRACTION_OUTCOME_TYPES: readonly UsageEventType[] = [
  USAGE_EVENT_TYPE.ai_invoice_extraction_ok,
  USAGE_EVENT_TYPE.ai_invoice_extraction_failed,
]

export type AiExtractionErrorType =
  | "RATE_LIMIT"
  | "UNAVAILABLE"
  | "EMPTY_RESPONSE"
  | "PARSE_ERROR"
  | "OTHER"

export const AI_EXTRACTION_ERROR_TYPES: readonly AiExtractionErrorType[] = [
  "RATE_LIMIT",
  "UNAVAILABLE",
  "EMPTY_RESPONSE",
  "PARSE_ERROR",
  "OTHER",
]
