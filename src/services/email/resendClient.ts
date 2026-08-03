import { Resend } from "resend"

// Lazy initialization to ensure dotenv has loaded before we check env vars
let _resend: Resend | null = null
let _initialized = false

export function getResendClient(): Resend | null {
  if (!_initialized) {
    _initialized = true
    if (process.env.RESEND_API_KEY) {
      _resend = new Resend(process.env.RESEND_API_KEY)
    } else {
      console.warn(
        "RESEND_API_KEY not set - emails will be logged to console only"
      )
    }
  }
  return _resend
}

export function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "noreply@govantory.com"
}
