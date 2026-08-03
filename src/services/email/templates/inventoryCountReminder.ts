interface InventoryCountReminderParams {
  userName: string
  magicLink: string
  orgName: string
  weekIdentifier: string
}

export function getInventoryCountReminderHtml(
  params: InventoryCountReminderParams,
): string {
  const { userName, magicLink, orgName, weekIdentifier } = params

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inventory Count – ${weekIdentifier}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090b; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
          <!-- Logo -->
          <tr>
            <td style="padding-bottom: 32px; text-align: center;">
              <span style="color: #06b6d4; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Vantory</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 40px 36px;">
              <!-- Icon + Heading -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom: 8px;">
                    <span style="font-size: 32px;">📋</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 16px;">
                    <h1 style="margin: 0; color: #fafafa; font-size: 22px; font-weight: 600; line-height: 1.3;">
                      Time for your weekly inventory count
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 8px;">
                    <p style="margin: 0; color: #a1a1aa; font-size: 15px; line-height: 1.6;">
                      Hi ${userName},
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 8px;">
                    <p style="margin: 0; color: #a1a1aa; font-size: 15px; line-height: 1.6;">
                      It's count day at <strong style="color: #e4e4e7;">${orgName}</strong>! Tap the button below to open your tally screen — it logs you in automatically, no password needed.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 28px;">
                    <p style="margin: 0; color: #71717a; font-size: 13px; line-height: 1.5;">
                      Week: <strong style="color: #a1a1aa;">${weekIdentifier}</strong>
                    </p>
                  </td>
                </tr>
                <!-- CTA Button -->
                <tr>
                  <td style="padding-bottom: 28px; text-align: center;">
                    <a href="${magicLink}"
                       style="display: inline-block; background-color: #06b6d4; color: #09090b; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; letter-spacing: 0.2px;">
                      Start Inventory Count →
                    </a>
                  </td>
                </tr>
                <!-- Warning -->
                <tr>
                  <td style="border-top: 1px solid #27272a; padding-top: 24px;">
                    <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.6;">
                      ⚠️ This link expires in <strong>24 hours</strong> and can only be used once. If it has expired, contact your admin to generate a new link.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; text-align: center;">
              <p style="margin: 0; color: #52525b; font-size: 12px;">
                Vantory · Inventory Management
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}

export function getInventoryCountReminderText(
  params: InventoryCountReminderParams,
): string {
  const { userName, magicLink, orgName, weekIdentifier } = params

  return `
Hi ${userName},

It's count day at ${orgName}!

Time for your weekly inventory count (${weekIdentifier}). Tap the link below to open your tally screen — it logs you in automatically.

Start count: ${magicLink}

This link expires in 24 hours. If it has expired, contact your admin.

— Vantory
`.trim()
}
