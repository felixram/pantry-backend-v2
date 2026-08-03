export interface InvoiceReceivedTemplateParams {
  supplierName: string
  invoiceTotal: number
  itemCount: number
  hasUnmatchedItems: boolean
  hasDiscrepancies: boolean
  reviewUrl: string
}

export function getInvoiceReceivedEmailHtml(params: InvoiceReceivedTemplateParams): string {
  const { supplierName, invoiceTotal, itemCount, hasUnmatchedItems, hasDiscrepancies, reviewUrl } = params

  const warnings: string[] = []
  if (hasUnmatchedItems) warnings.push("Some items could not be matched to products")
  if (hasDiscrepancies) warnings.push("Quantity or price discrepancies detected")

  const warningHtml = warnings.length > 0
    ? `<div style="background-color:#451a03;border:1px solid #92400e;border-radius:8px;padding:12px 16px;margin:16px 0;">
        <p style="color:#fbbf24;font-weight:600;margin:0 0 8px 0;">⚠️ Attention Required</p>
        ${warnings.map(w => `<p style="color:#fcd34d;margin:4px 0;">• ${w}</p>`).join("")}
      </div>`
    : ""

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background-color:#1e293b;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0e7490,#06b6d4);padding:24px 32px;">
      <h1 style="color:#ffffff;font-size:20px;margin:0;">📄 New Invoice Received</h1>
    </div>
    <div style="padding:24px 32px;">
      <p style="color:#e2e8f0;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        A new invoice from <strong style="color:#06b6d4;">${supplierName}</strong> has been processed and is ready for your review.
      </p>

      <div style="background-color:#0f172a;border-radius:8px;padding:16px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="color:#94a3b8;padding:4px 0;">Supplier</td>
            <td style="color:#e2e8f0;text-align:right;padding:4px 0;">${supplierName}</td>
          </tr>
          <tr>
            <td style="color:#94a3b8;padding:4px 0;">Total</td>
            <td style="color:#e2e8f0;text-align:right;padding:4px 0;font-weight:600;">$${invoiceTotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color:#94a3b8;padding:4px 0;">Items</td>
            <td style="color:#e2e8f0;text-align:right;padding:4px 0;">${itemCount}</td>
          </tr>
        </table>
      </div>

      ${warningHtml}

      <div style="text-align:center;margin:24px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:linear-gradient(135deg,#0e7490,#06b6d4);color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:16px;">
          Review Invoice →
        </a>
      </div>

      <p style="color:#64748b;font-size:13px;text-align:center;margin:24px 0 0 0;">
        This invoice requires your review before stock levels are updated.
      </p>
    </div>
  </div>
</body>
</html>`
}

export function getInvoiceReceivedEmailText(params: InvoiceReceivedTemplateParams): string {
  const { supplierName, invoiceTotal, itemCount, hasUnmatchedItems, hasDiscrepancies, reviewUrl } = params

  let text = `New Invoice Received\n\n`
  text += `A new invoice from ${supplierName} has been processed.\n\n`
  text += `Supplier: ${supplierName}\n`
  text += `Total: $${invoiceTotal.toFixed(2)}\n`
  text += `Items: ${itemCount}\n\n`

  if (hasUnmatchedItems) text += `⚠️ Some items could not be matched to products\n`
  if (hasDiscrepancies) text += `⚠️ Quantity or price discrepancies detected\n`

  text += `\nReview this invoice: ${reviewUrl}\n`

  return text
}
