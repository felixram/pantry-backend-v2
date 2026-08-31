import { and, eq, inArray, isNull } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { Product } from "../../../db/schema/product.ts"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { Supplier } from "../../../db/schema/supplier.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { lineTotalWithDiscount } from "../../../utils/discountMath.ts"

const manualItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  sku: z.string().optional(),
  qty: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  unit: z.string().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  taxable: z.boolean().default(true),
  taxAmount: z.number().optional(),
  productId: z.string().uuid().optional(),
})

const newSupplierSchema = z.object({
  name: z.string().min(1),
  contact_name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  supplier_type: z.enum(["PRIMARY", "SECONDARY"]).optional().default("PRIMARY"),
})

/**
 * Manual-entry fallback for an invoice whose AI extraction keeps failing.
 * Takes hand-keyed supplier + line items, writes them as if they'd been
 * extracted, and moves the invoice into REVIEW so the normal confirm flow
 * (match products, resolve discrepancies, update stock) takes over.
 *
 * Allowed for any FAILED invoice; the detail page only surfaces it
 * prominently after 3 retries.
 */
export const manualEntryInvoiceProcedure = adminMutation
  .input(
    z.object({
      invoiceId: z.string().uuid(),
      supplierId: z.string().uuid().nullable().optional(),
      newSupplier: newSupplierSchema.optional(),
      purchaseOrderId: z.string().uuid().nullable().optional(),
      invoiceNumber: z.string().optional(),
      subtotal: z.number().optional(),
      taxAmount: z.number().optional(),
      total: z.number().optional(),
      items: z.array(manualItemSchema).min(1, "At least one line item is required"),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
    }
    const tenantId = ctx.tenantId

    const invoice = await ctx.db.query.Invoice.findFirst({
      where: and(
        eq(Invoice.id, input.invoiceId),
        eq(Invoice.tenant_id, tenantId),
        isNull(Invoice.deletedAt),
      ),
    })

    if (!invoice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" })
    }

    if (invoice.status !== INVOICE_STATUS.failed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only failed invoices can be entered manually",
      })
    }

    // Validate every referenced product belongs to this tenant — same guard
    // as updateItemMatch.ts, since these ids flow into confirmInvoice.ts's
    // stock writes.
    const productIds = [...new Set(input.items.map((i) => i.productId).filter((id): id is string => !!id))]
    if (productIds.length > 0) {
      const owned = await ctx.db
        .select({ id: Product.id })
        .from(Product)
        .where(and(inArray(Product.id, productIds), eq(Product.tenant_id, tenantId)))
      if (owned.length !== productIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "One or more products not found" })
      }
    }

    return await ctx.db.transaction(async (tx) => {
      // Resolve supplier: existing (ownership-checked), or newly created.
      let matchedSupplierId: string | null = invoice.matched_supplier_id ?? null

      if (input.supplierId) {
        const supplier = await tx.query.Supplier.findFirst({
          where: and(
            eq(Supplier.id, input.supplierId),
            eq(Supplier.tenant_id, tenantId),
            isNull(Supplier.deletedAt),
          ),
          columns: { id: true },
        })
        if (!supplier) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" })
        }
        matchedSupplierId = supplier.id
      } else if (input.supplierId === null) {
        matchedSupplierId = null
      } else if (input.newSupplier) {
        const [created] = await tx
          .insert(Supplier)
          .values({
            name: input.newSupplier.name,
            contact_name: input.newSupplier.contact_name,
            email: input.newSupplier.email || null,
            phone: input.newSupplier.phone || null,
            address: input.newSupplier.address || null,
            supplier_type: input.newSupplier.supplier_type,
            tenant_id: tenantId,
          })
          .returning({ id: Supplier.id })
        matchedSupplierId = created!.id
      }

      // Resolve PO: existing (ownership-checked), cleared, or left as-is.
      let matchedPurchaseOrderId: string | null = invoice.matched_purchase_order_id ?? null
      if (input.purchaseOrderId) {
        const po = await tx.query.PurchaseOrder.findFirst({
          where: and(
            eq(PurchaseOrder.id, input.purchaseOrderId),
            eq(PurchaseOrder.tenant_id, tenantId),
          ),
          columns: { id: true },
        })
        if (!po) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" })
        }
        matchedPurchaseOrderId = po.id
      } else if (input.purchaseOrderId === null) {
        matchedPurchaseOrderId = null
      }

      // Replace any partial items left by a prior failed run.
      await tx.delete(InvoiceItem).where(eq(InvoiceItem.invoice_id, input.invoiceId))

      await tx.insert(InvoiceItem).values(
        input.items.map((item) => ({
          invoice_id: input.invoiceId,
          extracted_name: item.description,
          extracted_sku: item.sku || null,
          extracted_qty: item.qty,
          extracted_unit_price: item.unitPrice,
          extracted_unit: item.unit || null,
          extracted_discount_percent: item.discountPercent ?? null,
          extracted_line_total: lineTotalWithDiscount(item.qty, item.unitPrice, item.discountPercent ?? 0),
          is_taxable: item.taxable,
          extracted_tax_amount: item.taxAmount ?? null,
          matched_product_id: null,
          confirmed_product_id: item.productId ?? null,
          match_method: item.productId ? "manual" : null,
        })),
      )

      await tx
        .update(Invoice)
        .set({
          matched_supplier_id: matchedSupplierId,
          matched_purchase_order_id: matchedPurchaseOrderId,
          invoice_number: input.invoiceNumber ?? invoice.invoice_number ?? null,
          subtotal: input.subtotal ?? null,
          tax_amount: input.taxAmount ?? null,
          total: input.total ?? null,
          extracted_data: { manualEntry: true },
          extraction_confidence: null,
          processing_error: null,
          manual_entry: true,
          status: INVOICE_STATUS.review,
        })
        .where(and(eq(Invoice.id, input.invoiceId), eq(Invoice.tenant_id, tenantId)))

      return { message: "Invoice ready for review" }
    })
  })
