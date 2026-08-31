import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { User } from "../../../db/schema/users.ts";
import { and, eq } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { validatePermission } from "./helpers/permissionMatrix.ts";
import type { userRoles } from "../../../types/user.ts";

/**
 * Built-in order-email body, used when the supplier has no saved template.
 * `{{placeholders}}` are filled in per-PO by the frontend at send time —
 * see the `values` map returned below. Deliberately excludes pricing, the
 * supplier contact block, and internal PO status.
 */
export const DEFAULT_ORDER_EMAIL_TEMPLATE = `Hi {{supplier_contact}},

We'd like to place the following order:

PO Number: {{po_number}}
Order Date: {{order_date}}

{{deliver_to}}

Items:
{{items}}

Please confirm you can fulfil this order and let us know the estimated delivery date.

Thank you,
{{sender_name}}
{{org_name}}`;

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
        tenant: true,
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

    validatePermission(ctx.user!.role as userRoles, purchaseOrder.status, "email_supplier");

    const sender = await ctx.db.query.User.findFirst({
      where: eq(User.id, ctx.user!.id),
      columns: { name: true, last_name: true },
    });
    const senderName = [sender?.name, sender?.last_name].filter(Boolean).join(" ").trim();

    const loc = purchaseOrder.destinationLocation;
    const deliverToLines: string[] = [];
    if (loc) {
      deliverToLines.push(`Deliver to: ${loc.name}`);
      if (loc.address) deliverToLines.push(`  ${loc.address}`);
      const cityLine = [loc.city, [loc.state, loc.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      if (cityLine) deliverToLines.push(`  ${cityLine}`);
    }

    const items = purchaseOrder.purchaseOrderItems
      .map((item) => {
        const name = item.product?.name || "Unknown product";
        const sku = item.product?.sku ? ` (SKU ${item.product.sku})` : "";
        const unit = item.unit ? ` ${item.unit}` : "";
        return `- ${name}${sku} — ${item.qty}${unit}`;
      })
      .join("\n");

    return {
      to: purchaseOrder.supplier.email || "",
      subject: `Purchase Order ${purchaseOrder.po_number}`,
      supplier_id: purchaseOrder.supplier.id,
      supplier_name: purchaseOrder.supplier.name,
      // The editable, reusable body: this supplier's saved template, or the
      // built-in default. The frontend renders it with `values` and can
      // save an edited version back via supplier.update.
      template: purchaseOrder.supplier.email_template ?? DEFAULT_ORDER_EMAIL_TEMPLATE,
      defaultTemplate: DEFAULT_ORDER_EMAIL_TEMPLATE,
      isCustom: !!purchaseOrder.supplier.email_template,
      values: {
        supplier_contact: purchaseOrder.supplier.contact_name || purchaseOrder.supplier.name,
        supplier_name: purchaseOrder.supplier.name,
        po_number: purchaseOrder.po_number,
        order_date: new Date(purchaseOrder.createdAt).toLocaleDateString(),
        deliver_to: deliverToLines.join("\n"),
        items,
        sender_name: senderName,
        org_name: purchaseOrder.tenant?.name ?? "",
      },
    };
  });
