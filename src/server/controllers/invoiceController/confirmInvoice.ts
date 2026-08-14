import { and, eq, isNull, sql } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { InvoiceItem } from "../../../db/schema/invoiceItem.ts"
import { Location } from "../../../db/schema/location.ts"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts"
import { Product } from "../../../db/schema/product.ts"
import { ProductAlias } from "../../../db/schema/productAlias.ts"
import { ProductVersion } from "../../../db/schema/productVersion.ts"
import { Stock } from "../../../db/schema/stock.ts"
import { StockMovement } from "../../../db/schema/stockMovement.ts"
import { Supplier } from "../../../db/schema/supplier.ts"
import { TenantInvoiceConfig } from "../../../db/schema/tenantInvoiceConfig.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"
import { ORDER_STATUS } from "../../../types/orders.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import type { InferInsertModel } from "drizzle-orm"
import {
  receivePurchaseOrder,
  type ReceivedItemQuantity,
} from "../../controllers/purchase_orderController/helpers/receivePurchaseOrder.ts"
import { rebuildSupplierProfile } from "../../../services/invoice/supplierProfileBuilder.ts"
import { applyDiscount } from "../../../utils/discountMath.ts"

export const confirmInvoiceProcedure = adminMutation
  .input(
    z.object({
      invoiceId: z.string().uuid(),
      reviewNotes: z.string().optional(),
      newSupplier: z.object({
        name: z.string().min(1),
        contact_name: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        supplier_type: z.enum(["PRIMARY", "SECONDARY"]).optional().default("PRIMARY"),
      }).optional(),
      skipSupplierCreation: z.boolean().optional(),
      confirmedSubtotal: z.number().optional(),
      confirmedTaxAmount: z.number().optional(),
      confirmedTotal: z.number().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    return await ctx.db.transaction(async (tx) => {
      // 1. Validate invoice is in REVIEW status
      const invoice = await tx.query.Invoice.findFirst({
        where: and(
          eq(Invoice.id, input.invoiceId),
          eq(Invoice.tenant_id, ctx.tenantId!),
          isNull(Invoice.deletedAt)
        ),
        with: {
          items: true,
        },
      })

      if (!invoice) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invoice not found",
        })
      }

      if (invoice.status !== INVOICE_STATUS.review && invoice.status !== INVOICE_STATUS.matched) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invoice must be in REVIEW or MATCHED status to confirm. Current status: ${invoice.status}`,
        })
      }

      // Check all items have a confirmed or matched product
      const unmatchedItems = invoice.items.filter(
        (item) => !item.confirmed_product_id && !item.matched_product_id
      )
      if (unmatchedItems.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${unmatchedItems.length} item(s) have no matched product. Please match all items before confirming.`,
        })
      }

      // 2. Handle missing supplier
      if (!invoice.matched_supplier_id && !input.newSupplier && !input.skipSupplierCreation) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invoice has no matched supplier. Please provide a new supplier to create, or set skipSupplierCreation to confirm without one.",
        })
      }

      if (!invoice.matched_supplier_id && input.newSupplier) {
        const [newSupplier] = await tx
          .insert(Supplier)
          .values({
            name: input.newSupplier.name,
            contact_name: input.newSupplier.contact_name,
            email: input.newSupplier.email || null,
            phone: input.newSupplier.phone || null,
            address: input.newSupplier.address || null,
            supplier_type: input.newSupplier.supplier_type,
            tenant_id: ctx.tenantId!,
          })
          .returning()

        await tx
          .update(Invoice)
          .set({ matched_supplier_id: newSupplier!.id })
          .where(eq(Invoice.id, input.invoiceId))
      }

      // 3. Build confirmed items — OOS lines are excluded here too, matching
      // the PO-received branch below (they were never actually received).
      const confirmedItems = invoice.items
        .filter((item) => !item.is_out_of_stock)
        .map((item) => ({
          productId: (item.confirmed_product_id || item.matched_product_id)!,
          qty: item.confirmed_qty ?? item.extracted_qty ?? 0,
          unitPrice: item.confirmed_unit_price ?? item.extracted_unit_price ?? 0,
        }))

      // Set status to CONFIRMED + apply tax overrides if provided
      const confirmUpdate: Record<string, any> = {
        status: INVOICE_STATUS.confirmed,
        reviewed_by: ctx.user!.id,
        reviewed_at: new Date(),
        review_notes: input.reviewNotes || null,
      }
      if (input.confirmedSubtotal !== undefined) confirmUpdate.subtotal = input.confirmedSubtotal
      if (input.confirmedTaxAmount !== undefined) confirmUpdate.tax_amount = input.confirmedTaxAmount
      if (input.confirmedTotal !== undefined) confirmUpdate.total = input.confirmedTotal

      await tx
        .update(Invoice)
        .set(confirmUpdate)
        .where(eq(Invoice.id, input.invoiceId))

      // 3. Check if matched to a PO in ORDERED status
      let stockSummary: string

      if (invoice.matched_purchase_order_id) {
        const po = await tx.query.PurchaseOrder.findFirst({
          where: and(eq(PurchaseOrder.id, invoice.matched_purchase_order_id), eq(PurchaseOrder.tenant_id, ctx.tenantId!)),
        })

        if (po && po.status === ORDER_STATUS.ordered && po.destination_location_id) {
          // Build received items from confirmed invoice items
          // Aggregate qty per PO item, excluding OOS items
          // Also track effective prices (post-discount) per PO item
          const qtyByPoItem = new Map<string, number>()
          const priceByPoItem = new Map<string, number>()
          for (const item of invoice.items) {
            if (!item.matched_po_item_id) continue
            if (item.is_out_of_stock) continue // OOS items are not received
            const qty = item.confirmed_qty ?? item.extracted_qty ?? 0
            qtyByPoItem.set(
              item.matched_po_item_id,
              (qtyByPoItem.get(item.matched_po_item_id) ?? 0) + qty
            )
            // Store effective (post-discount) price — use first non-OOS line's price
            if (!priceByPoItem.has(item.matched_po_item_id)) {
              const unitPrice = item.confirmed_unit_price ?? item.extracted_unit_price ?? 0
              const discount = item.extracted_discount_percent ?? 0
              priceByPoItem.set(item.matched_po_item_id, applyDiscount(unitPrice, discount))
            }
          }

          const receivedItems: ReceivedItemQuantity[] = [...qtyByPoItem.entries()].map(
            ([itemId, totalQty]) => ({
              itemId,
              receivedQty: totalQty,
              notes: `From invoice confirmation`,
            })
          )

          // Use existing receivePurchaseOrder helper
          stockSummary = await receivePurchaseOrder(
            tx,
            po.id,
            po.destination_location_id,
            ctx.user!.id,
            ctx.tenantId!,
            receivedItems,
            "Invoice confirmation"
          )

          // Update PO item prices with effective (post-discount) invoice prices
          for (const [poItemId, effectivePrice] of priceByPoItem) {
            await tx
              .update(PurchaseOrderItem)
              .set({ unit_price: effectivePrice })
              .where(eq(PurchaseOrderItem.id, poItemId))
          }

          // Update PO with status + invoice totals
          await tx
            .update(PurchaseOrder)
            .set({
              status: ORDER_STATUS.received,
              subtotal: invoice.subtotal ?? null,
              tax_amount: invoice.tax_amount ?? null,
              total: invoice.total ?? null,
            })
            .where(eq(PurchaseOrder.id, po.id))
        } else {
          // PO not in ORDERED status or no destination — update stock directly
          stockSummary = await updateStockDirectly(
            tx,
            ctx.tenantId!,
            ctx.user!.id,
            confirmedItems,
            input.invoiceId,
            invoice.location_id ?? null
          )
        }
      } else {
        // 4. No matching PO — update stock directly
        stockSummary = await updateStockDirectly(
          tx,
          ctx.tenantId!,
          ctx.user!.id,
          confirmedItems,
          input.invoiceId,
          invoice.location_id ?? null
        )
      }

      // 5. Sync product data from invoice (cost price, tax status)
      let productsUpdated = 0
      for (const item of invoice.items) {
        const productId = item.confirmed_product_id || item.matched_product_id
        if (!productId) continue

        // Use confirmed price, or effective (discounted) extracted price
        let confirmedPrice = item.confirmed_unit_price ?? item.extracted_unit_price
        if (confirmedPrice != null && !item.confirmed_unit_price && item.extracted_discount_percent) {
          confirmedPrice = applyDiscount(confirmedPrice, item.extracted_discount_percent)
        }
        const isTaxable = item.is_taxable

        // Fetch the product with its active version
        const product = await tx.query.Product.findFirst({
          where: eq(Product.id, productId),
          with: { version: true },
        })
        if (!product) continue

        let updated = false

        // Update tax exempt status based on invoice item taxable flag
        const shouldBeExempt = !isTaxable
        if (product.is_tax_exempt !== shouldBeExempt) {
          await tx
            .update(Product)
            .set({ is_tax_exempt: shouldBeExempt })
            .where(eq(Product.id, productId))
          updated = true
        }

        // Update cost price if it changed — create a new ProductVersion
        if (confirmedPrice != null && product.version) {
          const currentCost = product.version.costPrice
          if (Math.abs(confirmedPrice - currentCost) > 0.001) {
            const nextVersion = (product.version.versionNumber ?? 0) + 1
            const newVersion: InferInsertModel<typeof ProductVersion> = {
              productId: productId,
              versionNumber: nextVersion,
              costPrice: confirmedPrice,
              costPriceUnit: product.version.costPriceUnit,
              sellingPrice: product.version.sellingPrice,
              sellingPriceUnit: product.version.sellingPriceUnit,
              description: product.version.description,
            }

            const [inserted] = await tx
              .insert(ProductVersion)
              .values(newVersion)
              .returning({ id: ProductVersion.id })

            if (inserted) {
              await tx
                .update(Product)
                .set({ activeVersionId: inserted.id })
                .where(eq(Product.id, productId))
            }
            updated = true
          }
        }

        if (updated) productsUpdated++
      }

      // 6. Set accuracy flags and populate product aliases
      const supplierId = invoice.matched_supplier_id ?? (input.newSupplier ? (await tx.query.Invoice.findFirst({
        where: eq(Invoice.id, input.invoiceId),
        columns: { matched_supplier_id: true },
      }))?.matched_supplier_id : null)

      for (const item of invoice.items) {
        const productId = item.confirmed_product_id || item.matched_product_id
        if (!productId) continue

        // Accuracy flags
        const productMatchCorrect =
          !item.confirmed_product_id || item.confirmed_product_id === item.matched_product_id
        const priceExtractionCorrect =
          !item.confirmed_unit_price ||
          (item.extracted_unit_price != null &&
            Math.abs(item.confirmed_unit_price - item.extracted_unit_price) < 0.01)
        const qtyExtractionCorrect =
          !item.confirmed_qty ||
          (item.extracted_qty != null && item.confirmed_qty === item.extracted_qty)

        await tx
          .update(InvoiceItem)
          .set({
            product_match_correct: productMatchCorrect,
            price_extraction_correct: priceExtractionCorrect,
            qty_extraction_correct: qtyExtractionCorrect,
          })
          .where(eq(InvoiceItem.id, item.id))

        // Populate product alias if human corrected the match or manually matched
        if (
          supplierId &&
          item.extracted_name &&
          (
            (item.confirmed_product_id && item.confirmed_product_id !== item.matched_product_id) ||
            (!item.matched_product_id && item.confirmed_product_id)
          )
        ) {
          await tx
            .insert(ProductAlias)
            .values({
              tenant_id: ctx.tenantId!,
              supplier_id: supplierId,
              alias_name: item.extracted_name,
              product_id: item.confirmed_product_id!,
              source_invoice_item_id: item.id,
            })
            .onConflictDoUpdate({
              target: [
                ProductAlias.tenant_id,
                ProductAlias.supplier_id,
                ProductAlias.alias_name,
              ],
              set: {
                product_id: item.confirmed_product_id!,
                use_count: sql`${ProductAlias.use_count} + 1`,
                source_invoice_item_id: item.id,
              },
            })
        }
      }

      // 7. Rebuild supplier profile
      if (supplierId) {
        await rebuildSupplierProfile(tx as any, ctx.tenantId!, supplierId)
      }

      // 8. Set final status to APPLIED
      await tx
        .update(Invoice)
        .set({ status: INVOICE_STATUS.applied })
        .where(eq(Invoice.id, input.invoiceId))

      return {
        message: "Invoice confirmed and stock updated",
        stockSummary,
        productsUpdated,
      }
    })
  })

/**
 * Update stock directly when there's no matching PO.
 * Uses the invoice's location_id, falls back to tenant config default.
 */
async function updateStockDirectly(
  tx: any,
  tenantId: string,
  userId: string,
  items: Array<{ productId: string; qty: number; unitPrice: number }>,
  invoiceId: string,
  invoiceLocationId: string | null
): Promise<string> {
  let locationId = invoiceLocationId

  // Fallback to tenant invoice config default location
  if (!locationId) {
    const config = await tx.query.TenantInvoiceConfig.findFirst({
      where: eq(TenantInvoiceConfig.tenant_id, tenantId),
    })
    locationId = config?.default_location_id ?? null
  }

  if (!locationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No location assigned to this invoice and no default location configured. Please configure a default location in invoice settings.",
    })
  }

  // Verify location belongs to this tenant
  const location = await tx.query.Location.findFirst({
    where: and(
      eq(Location.id, locationId),
      eq(Location.tenant_id, tenantId),
      isNull(Location.deletedAt)
    ),
  })

  if (!location) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The location assigned to this invoice no longer exists or belongs to a different tenant.",
    })
  }

  let stockUpdated = 0

  for (const item of items) {
    if (item.qty <= 0) continue

    // Check for existing stock
    const existingStock = await tx.query.Stock.findFirst({
      where: and(
        eq(Stock.location_id, locationId),
        eq(Stock.productId, item.productId)
      ),
    })

    if (existingStock) {
      await tx
        .update(Stock)
        .set({ qty: existingStock.qty + item.qty })
        .where(eq(Stock.id, existingStock.id))
    } else {
      await tx.insert(Stock).values({
        location_id: locationId,
        productId: item.productId,
        qty: item.qty,
        minimumStockLevel: 0,
        tenant_id: tenantId,
      })
    }

    // Log stock movement
    await tx.insert(StockMovement).values({
      product_id: item.productId,
      location_id: locationId,
      change_qty: item.qty,
      reason: `Invoice #${invoiceId} confirmed (no PO match)`,
      user_id: userId,
      tenant_id: tenantId,
    })

    stockUpdated++
  }

  return `Updated ${stockUpdated} stock records from invoice (direct, no PO)`
}
