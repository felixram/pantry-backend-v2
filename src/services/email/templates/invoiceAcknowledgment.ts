export interface InvoiceAcknowledgmentTemplateParams {
  senderName: string
  itemCount: number
  receivedAt: string
}

export function getInvoiceAcknowledgmentEmailHtml(params: InvoiceAcknowledgmentTemplateParams): string {
  const { senderName, itemCount, receivedAt } = params

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background-color:#1e293b;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#059669,#10b981);padding:24px 32px;">
      <h1 style="color:#ffffff;font-size:20px;margin:0;">Invoice Received</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        Hi ${senderName},
      </p>
      <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        We've received your invoice and it is now being reviewed by our team.
      </p>

      <div style="background-color:#0f172a;border-radius:8px;padding:16px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="color:#94a3b8;padding:4px 0;">Items</td>
            <td style="color:#e2e8f0;text-align:right;padding:4px 0;">${itemCount}</td>
          </tr>
          <tr>
            <td style="color:#94a3b8;padding:4px 0;">Received</td>
            <td style="color:#e2e8f0;text-align:right;padding:4px 0;">${receivedAt}</td>
          </tr>
        </table>
      </div>

      <p style="color:#64748b;font-size:13px;margin:24px 0 0 0;">
        This is an automated confirmation. No action is needed on your part.
      </p>
    </div>
  </div>
</body>
</html>`
}

export function getInvoiceAcknowledgmentEmailText(params: InvoiceAcknowledgmentTemplateParams): string {
  const { senderName, itemCount, receivedAt } = params

  let text = `Invoice Received\n\n`
  text += `Hi ${senderName},\n\n`
  text += `We've received your invoice and it is now being reviewed by our team.\n\n`
  text += `Items: ${itemCount}\n`
  text += `Received: ${receivedAt}\n\n`
  text += `This is an automated confirmation. No action is needed on your part.\n`

  return text
}
