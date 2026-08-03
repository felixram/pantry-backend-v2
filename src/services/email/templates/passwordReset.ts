interface PasswordResetTemplateParams {
  userName: string
  resetUrl: string
  expiresAt: Date
}

export function getPasswordResetEmailHtml(
  params: PasswordResetTemplateParams
): string {
  const { userName, resetUrl, expiresAt } = params
  const expiryMinutes = Math.round(
    (expiresAt.getTime() - Date.now()) / (1000 * 60)
  )

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090b; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <table cellpadding="0" cellspacing="0" style="display: inline-table;">
                <tr>
                  <td style="background: linear-gradient(135deg, rgba(14,116,144,0.3) 0%, rgba(8,145,178,0.1) 100%); border: 1px solid rgba(34,211,238,0.4); border-radius: 10px; padding: 8px 10px; vertical-align: middle;">
                    <span style="font-family: ui-monospace, monospace; font-size: 18px; font-weight: bold; color: #22d3ee;">V</span>
                  </td>
                  <td style="padding-left: 10px; vertical-align: middle;">
                    <span style="font-size: 20px; font-weight: bold; color: #ffffff; letter-spacing: -0.5px;">Vantory</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color: #18181b; border-radius: 12px; padding: 40px; border: 1px solid #27272a;">
              <h1 style="color: #ffffff; font-size: 24px; margin: 0 0 16px 0; text-align: center;">
                Reset Your Password
              </h1>

              <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">
                Hi ${userName},<br><br>
                We received a request to reset your password. Click the button below to choose a new password.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 24px 0;">
                    <a href="${resetUrl}"
                       style="display: inline-block; background: linear-gradient(to right, #0891b2, #06b6d4);
                              color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px;
                              padding: 14px 32px; border-radius: 8px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #71717a; font-size: 14px; line-height: 1.5; margin: 24px 0 0 0; text-align: center;">
                This link expires in ${expiryMinutes} minutes.<br>
                If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
              </p>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding-top: 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1c1917; border-radius: 8px; padding: 16px; border: 1px solid #292524;">
                <tr>
                  <td style="color: #fbbf24; font-size: 13px; text-align: center;">
                    If you didn't request this, someone may be trying to access your account.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 32px; text-align: center;">
              <p style="color: #52525b; font-size: 12px; margin: 0;">
                Vantory - Inventory Management Made Simple
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export function getPasswordResetEmailText(
  params: PasswordResetTemplateParams
): string {
  const { userName, resetUrl, expiresAt } = params
  const expiryMinutes = Math.round(
    (expiresAt.getTime() - Date.now()) / (1000 * 60)
  )

  return `
Reset Your Password

Hi ${userName},

We received a request to reset your password. Click the link below to choose a new password:

${resetUrl}

This link expires in ${expiryMinutes} minutes.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

--
Vantory - Inventory Management Made Simple
  `.trim()
}
