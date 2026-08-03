export interface InvoiceBounceTemplateParams {
  senderEmail: string
  inboundAddress: string
}

export function getInvoiceBounceEmailHtml(params: InvoiceBounceTemplateParams): string {
  const { senderEmail, inboundAddress } = params

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background-color:#1e293b;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#991b1b,#dc2626);padding:24px 32px;">
      <h1 style="color:#ffffff;font-size:20px;margin:0;">Invoice Not Processed</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        An invoice sent from <strong style="color:#f87171;">${senderEmail}</strong> to <strong style="color:#94a3b8;">${inboundAddress}</strong> could not be processed.
      </p>

      <div style="background-color:#451a03;border:1px solid #92400e;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <p style="color:#fbbf24;font-weight:600;margin:0 0 8px 0;">Sender not recognized</p>
        <p style="color:#fcd34d;margin:4px 0;font-size:14px;">
          Your email address is not associated with a known supplier or user in this organization. Only emails from recognized suppliers or organization members are accepted.
        </p>
      </div>

      <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:16px 0 0 0;">
        If you believe this is an error, please contact the organization administrator to have your email or domain added as a recognized supplier.
      </p>
    </div>
  </div>
</body>
</html>`
}

export function getInvoiceBounceEmailText(params: InvoiceBounceTemplateParams): string {
  const { senderEmail, inboundAddress } = params

  let text = `Invoice Not Processed\n\n`
  text += `An invoice sent from ${senderEmail} to ${inboundAddress} could not be processed.\n\n`
  text += `Reason: Sender not recognized\n\n`
  text += `Your email address is not associated with a known supplier or user in this organization. `
  text += `Only emails from recognized suppliers or organization members are accepted.\n\n`
  text += `If you believe this is an error, please contact the organization administrator to have your email or domain added as a recognized supplier.\n`

  return text
}
