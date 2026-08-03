import { getResendClient } from "../email/resendClient.ts"
import { logger } from "../../utils/logger.ts"

/**
 * Verify a Resend inbound webhook using the Resend SDK (Svix-based).
 *
 * Resend webhooks use Svix under the hood with three headers:
 *   svix-id, svix-timestamp, svix-signature
 *
 * In production, RESEND_INBOUND_WEBHOOK_SECRET must be set.
 * In development, missing secret allows all requests through.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: Record<string, string | undefined>
): boolean {
  const webhookSecret =
    process.env.RESEND_INBOUND_WEBHOOK_SECRET ||
    process.env.RESEND_INBOUND_WEEBHOOK_SECRET // legacy typo fallback

  if (!webhookSecret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("RESEND_INBOUND_WEBHOOK_SECRET is not set in production — rejecting webhook")
      return false
    }
    return true // dev mode: allow without signature
  }

  const resend = getResendClient()
  if (!resend) {
    logger.error("Resend client not initialized — cannot verify webhook")
    return false
  }

  try {
    resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: headers["svix-id"] || "",
        timestamp: headers["svix-timestamp"] || "",
        signature: headers["svix-signature"] || "",
      },
      webhookSecret,
    })
    return true
  } catch (err) {
    logger.warn({ error: err }, "Resend webhook signature verification failed")
    return false
  }
}
