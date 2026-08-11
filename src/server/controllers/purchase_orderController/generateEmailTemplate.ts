import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { and, eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import {
  calculateLineTotal,
  calculateSubtotal,
} from "../../../utils/poTotals.ts";

// Minimal HTML-entity escaping for interpolated user-editable fields
// (product/supplier/location names, addresses) — these are user-editable
// elsewhere in the app, so unescaped interpolation into an HTML email body
// is a stored-XSS-in-email vector.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const generateEmailTemplate = authedProcedure
  .input(
    z.object({
      purchase_order_id: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const purchaseOrder = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(eq(PurchaseOrder.id, input.purchase_order_id), eq(PurchaseOrder.tenant_id, ctx.tenantId)),
      with: {
        supplier: true,
        destinationLocation: true,
        purchaseOrderItems: {
          with: {
            product: true,
          },
        },
      },
    });

    if (!purchaseOrder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Purchase order not found",
      });
    }

    if (!purchaseOrder.supplier) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Purchase order has no supplier",
      });
    }

    if (purchaseOrder.destination_location_id) {
      validateLocationAccess(ctx.user!, ctx.userLocationId, purchaseOrder.destination_location_id);
    }

    // Calculate total
    const total = calculateSubtotal(purchaseOrder.purchaseOrderItems);

    // Check if free shipping applies
    const freeShippingThreshold = purchaseOrder.supplier.free_shipping_minimum || 0;
    const freeShipping = total >= freeShippingThreshold && freeShippingThreshold > 0;

    // Generate HTML email
    const subject = `Purchase Order #${purchaseOrder.po_number} - ${new Date().toLocaleDateString()}`;

    const body = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .header h2 { margin: 0 0 10px 0; color: #2c3e50; }
    .info { margin-bottom: 20px; }
    .info p { margin: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #2c3e50; color: white; }
    tr:hover { background-color: #f5f5f5; }
    .total { font-size: 1.2em; font-weight: bold; text-align: right; margin-top: 20px; padding: 10px; background-color: #f4f4f4; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 2px solid #2c3e50; font-size: 0.9em; color: #666; }
    .free-shipping { background-color: #d4edda; color: #155724; padding: 10px; border-radius: 5px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>Purchase Order #${escapeHtml(purchaseOrder.po_number)}</h2>
    <p>Date: ${new Date(purchaseOrder.createdAt).toLocaleDateString()}</p>
    <p>Status: ${escapeHtml(purchaseOrder.status)}</p>
  </div>

  <div class="info">
    <h3>Supplier Information:</h3>
    <p><strong>${escapeHtml(purchaseOrder.supplier.name)}</strong></p>
    <p>Contact: ${escapeHtml(purchaseOrder.supplier.contact_name)}</p>
    <p>Phone: ${escapeHtml(purchaseOrder.supplier.phone || '')}</p>
    ${purchaseOrder.supplier.email ? `<p>Email: ${escapeHtml(purchaseOrder.supplier.email)}</p>` : ''}
    ${purchaseOrder.supplier.address ? `<p>Address: ${escapeHtml(purchaseOrder.supplier.address)}</p>` : ''}
  </div>

  ${purchaseOrder.destinationLocation ? `
  <div class="info">
    <h3>Delivery Location:</h3>
    <p><strong>${escapeHtml(purchaseOrder.destinationLocation.name)}</strong></p>
    <p>${escapeHtml(purchaseOrder.destinationLocation.address)}</p>
    ${purchaseOrder.destinationLocation.city ? `<p>${escapeHtml(purchaseOrder.destinationLocation.city)}, ${escapeHtml(purchaseOrder.destinationLocation.state || '')} ${escapeHtml(purchaseOrder.destinationLocation.postalCode || '')}</p>` : ''}
  </div>
  ` : ''}

  <div class="info">
    <h3>Order Details:</h3>
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th>SKU</th>
          <th>Quantity</th>
          <th>Unit Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${purchaseOrder.purchaseOrderItems.map((item) => {
          const product = item.product;
          const itemTotal = calculateLineTotal(item);
          return `
        <tr>
          <td>${escapeHtml(product?.name || 'Unknown Product')}</td>
          <td>${escapeHtml(product?.sku || 'N/A')}</td>
          <td>${item.qty}</td>
          <td>$${(item.unit_price || 0).toFixed(2)}</td>
          <td>$${itemTotal.toFixed(2)}</td>
        </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="total">
    <p>Total: $${total.toFixed(2)}</p>
  </div>

  ${freeShipping ? `
  <div class="free-shipping">
    <strong>🎉 Free Shipping Applies!</strong> This order qualifies for free shipping (threshold: $${freeShippingThreshold.toFixed(2)})
  </div>
  ` : freeShippingThreshold > 0 ? `
  <p style="color: #856404; background-color: #fff3cd; padding: 10px; border-radius: 5px;">
    <strong>Note:</strong> Free shipping available for orders over $${freeShippingThreshold.toFixed(2)} (current: $${total.toFixed(2)})
  </p>
  ` : ''}

  ${purchaseOrder.supplier.delivery_days ? `
  <p><strong>Delivery Days:</strong> ${escapeHtml(purchaseOrder.supplier.delivery_days)}</p>
  ` : ''}

  <div class="footer">
    <p>Thank you for your service!</p>
    <p>Please confirm receipt of this purchase order and provide an estimated delivery date.</p>
    <p><em>This is an automated email template. Please review before sending.</em></p>
  </div>
</body>
</html>
    `.trim();

    return {
      to: purchaseOrder.supplier.email || '',
      subject,
      body,
      metadata: {
        order_id: purchaseOrder.id,
        total,
        items_count: purchaseOrder.purchaseOrderItems.length,
        free_shipping: freeShipping,
      },
    };
  });
