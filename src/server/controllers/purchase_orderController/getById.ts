import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts";
import { TaxRate } from "../../../db/schema/taxRate.ts";
import { eq, and, isNull } from "drizzle-orm";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { resolveApplicableTaxRate } from "../../../utils/taxResolution.ts";
import {
  calculateLineTotal,
  calculateLineTax,
  calculateSubtotal,
  calculateTaxFromItems,
  calculateGrandTotal,
} from "../../../utils/poTotals.ts";
import { roundToCent } from "../../../utils/money.ts";
import { computeAllowedActions } from "./helpers/permissionMatrix.ts";
import type { userRoles } from "../../../types/user.ts";

export const getPurchaseOrderById = authedProcedure
  .input(
    z.object({
      id: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    const purchaseOrder = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(eq(PurchaseOrder.id, input.id), eq(PurchaseOrder.tenant_id, ctx.tenantId!)),
      with: {
        supplier: true,
        destinationLocation: true,
        purchaseOrderItems: {
          where: isNull(PurchaseOrderItem.deletedAt),
          with: {
            product: {
              with: {
                unitConversions: true,
                category: true,
                taxRate: true,
              },
            },
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

    // Validate location access for location-scoped users
    if (purchaseOrder.destination_location_id) {
      validateLocationAccess(ctx.user!, ctx.userLocationId, purchaseOrder.destination_location_id);
    }

    // Resolve location's default purchase tax rate
    let locationPurchaseTaxRate: { id: string; rate: number; name: string } | null = null;
    const loc = purchaseOrder.destinationLocation as any;
    if (loc?.default_purchase_tax_rate_id) {
      const taxRate = await ctx.db.query.TaxRate.findFirst({
        where: eq(TaxRate.id, loc.default_purchase_tax_rate_id),
      });
      if (taxRate) {
        locationPurchaseTaxRate = { id: taxRate.id, rate: taxRate.rate, name: taxRate.name };
      }
    }

    // Collect all unique tax rate IDs we need to look up (from products and categories)
    const taxRateIds = new Set<string>();
    for (const item of purchaseOrder.purchaseOrderItems) {
      const product = item.product as any;
      if (product?.tax_rate_id) taxRateIds.add(product.tax_rate_id);
      if (product?.category?.tax_rate_id) taxRateIds.add(product.category.tax_rate_id);
    }

    // Batch-fetch all tax rates
    const taxRateMap = new Map<string, { rate: number; name: string }>();
    if (locationPurchaseTaxRate) {
      taxRateMap.set(locationPurchaseTaxRate.id, { rate: locationPurchaseTaxRate.rate, name: locationPurchaseTaxRate.name });
    }
    for (const id of taxRateIds) {
      if (!taxRateMap.has(id)) {
        const tr = await ctx.db.query.TaxRate.findFirst({
          where: eq(TaxRate.id, id),
        });
        if (tr) {
          taxRateMap.set(tr.id, { rate: tr.rate, name: tr.name });
        }
      }
    }

    // Fetch audit logs with user information
    const auditLogs = await ctx.db.query.PurchaseOrderAudit.findMany({
      where: eq(PurchaseOrderAudit.purchaseOrderId, input.id),
      with: {
        user: true,
      },
    });

    // Calculate totals with tax info per item
    let taxableCount = 0;

    const itemsWithTax = purchaseOrder.purchaseOrderItems.map((item) => {
      const lineTotal = calculateLineTotal(item);

      const product = item.product as any;
      const resolved = resolveApplicableTaxRate({
        product: product ? { is_tax_exempt: product.is_tax_exempt, tax_rate_id: product.tax_rate_id } : null,
        category: product?.category ? { is_tax_exempt: product.category.is_tax_exempt, tax_rate_id: product.category.tax_rate_id } : null,
        locationTaxRateId: locationPurchaseTaxRate?.id ?? null,
      });

      let taxRate: number | null = null;
      let taxRateName: string | null = null;
      let taxAmount = 0;

      if (!resolved.isExempt && resolved.taxRateId) {
        const tr = taxRateMap.get(resolved.taxRateId);
        if (tr) {
          taxRate = tr.rate;
          taxRateName = tr.name;
          taxAmount = calculateLineTax(lineTotal, tr.rate);
          taxableCount++;
        }
      }

      return {
        ...item,
        tax: {
          isExempt: resolved.isExempt,
          isTaxable: !resolved.isExempt && resolved.taxRateId !== null,
          taxRateId: resolved.taxRateId,
          taxRate,
          taxRateName,
          taxAmount,
        },
      };
    });

    const computedSubtotal = calculateSubtotal(purchaseOrder.purchaseOrderItems);
    const computedTax = calculateTaxFromItems(itemsWithTax);

    // Use invoice-confirmed totals when available (PO received via invoice)
    const hasInvoiceTotals = purchaseOrder.tax_amount != null
    const finalSubtotal = hasInvoiceTotals && purchaseOrder.subtotal != null
      ? roundToCent(purchaseOrder.subtotal)
      : computedSubtotal
    const finalTax = hasInvoiceTotals
      ? roundToCent(purchaseOrder.tax_amount!)
      : computedTax
    const finalTotal = hasInvoiceTotals && purchaseOrder.total != null
      ? roundToCent(purchaseOrder.total)
      : calculateGrandTotal({ subtotal: computedSubtotal, tax: computedTax, shipping: 0 })

    const allowedActions = computeAllowedActions(
      { status: purchaseOrder.status, is_unlocked: purchaseOrder.is_unlocked ?? false },
      ctx.user!.role as userRoles
    );

    return {
      ...purchaseOrder,
      purchaseOrderItems: itemsWithTax,
      subtotal: finalSubtotal,
      totalTax: finalTax,
      total: finalTotal,
      taxableCount,
      items_count: purchaseOrder.purchaseOrderItems.length,
      allowedActions,
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        purchaseOrderId: log.purchaseOrderId,
        userId: log.userId,
        fieldChanged: log.fieldChanged,
        oldValue: log.oldValue,
        newValue: log.newValue,
        reason: log.reason,
        createdAt: log.createdAt,
        userName: log.user?.name || "Unknown User",
      })),
    };
  });
