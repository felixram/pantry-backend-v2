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
 * Builds a plain-text order request the user can edit before sending. It is
 * deliberately NOT a full record of the PO: no pricing, no supplier
 * contact block, no internal status — just what a supplier needs to fulfil
 * the order (reference number, where to ship, what to send). The frontend
 * makes the subject + body editable and hands them to a `mailto:` link.
 */
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

    const subject = `Purchase Order ${purchaseOrder.po_number}`;

    const greetingName = purchaseOrder.supplier.contact_name || purchaseOrder.supplier.name;

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

    const itemLines = purchaseOrder.purchaseOrderItems.map((item) => {
      const name = item.product?.name || "Unknown product";
      const sku = item.product?.sku ? ` (SKU ${item.product.sku})` : "";
      const unit = item.unit ? ` ${item.unit}` : "";
      return `- ${name}${sku} — ${item.qty}${unit}`;
    });

    const body = [
      `Hi ${greetingName},`,
      ``,
      `We'd like to place the following order:`,
      ``,
      `PO Number: ${purchaseOrder.po_number}`,
      `Order Date: ${new Date(purchaseOrder.createdAt).toLocaleDateString()}`,
      ...(deliverToLines.length ? ["", ...deliverToLines] : []),
      ``,
      `Items:`,
      ...itemLines,
      ``,
      `Please confirm you can fulfil this order and let us know the estimated delivery date.`,
      ``,
      `Thank you,`,
      ...(senderName ? [senderName] : []),
      purchaseOrder.tenant?.name ?? "",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      to: purchaseOrder.supplier.email || "",
      subject,
      body,
      metadata: {
        order_id: purchaseOrder.id,
        items_count: purchaseOrder.purchaseOrderItems.length,
      },
    };
  });
