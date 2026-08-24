import { db } from "../../db/index.ts"
import { UsageEvent } from "../../db/schema/usageEvent.ts"
import type { UsageEventType } from "../../types/usage.ts"
import { logger } from "../../utils/logger.ts"

interface RecordUsageEventParams {
  tenantId: string
  eventType: UsageEventType
  quantity: number
  costEstimate?: number | null
  metadata?: Record<string, unknown>
}

/**
 * Appends one row to the usage_event ledger. Never throws — metering must
 * not take down the invoice/email/upload flow it's attached to, so
 * failures are logged and swallowed rather than propagated.
 *
 * Quantity unit convention per eventType:
 *  - AI_INVOICE_EXTRACTION: total Gemini tokens (prompt + candidates)
 *  - EMAIL_SENT: 1 (one row per email actually sent)
 *  - FILE_STORAGE: bytes uploaded
 *
 * costEstimate is left null unless a caller supplies one — third-party
 * pricing isn't hardcoded here since it drifts; plug in real per-unit
 * rates at the reporting layer once you have current pricing to trust.
 */
export async function recordUsageEvent(params: RecordUsageEventParams): Promise<void> {
  try {
    await db.insert(UsageEvent).values({
      tenant_id: params.tenantId,
      eventType: params.eventType,
      quantity: Math.round(params.quantity),
      costEstimate: params.costEstimate ?? null,
      metadata: params.metadata ?? null,
    })
  } catch (err) {
    logger.error({ err, ...params }, "Failed to record usage event")
  }
}
