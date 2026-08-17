import { Supplier } from "../../../db/schema/supplier.ts"
import { and, eq } from "drizzle-orm"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const updateSupplierProcedure = adminMutation
  .input(
    z.object({
      supplierId: z.string(),
      contact_name: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      email: z.union([z.email(), z.literal("")]).optional(),
      delivery_days: z.string().optional(),
      minimum_order_amount: z.coerce.number().optional(),
      free_shipping_minimum: z.coerce.number().optional(),
      shipping_fee: z.coerce.number().optional(),
      supplier_type: z.enum(["PRIMARY", "SECONDARY"]).optional(),
      preferred_order_method: z
        .enum(["EMAIL", "PHONE", "WEBSITE", "IN_PERSON", "FAX", "OTHER"])
        .optional(),
      notes: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const [existingSupplier] = await ctx.db
      .select()
      .from(Supplier)
      .where(and(eq(Supplier.id, input.supplierId), eq(Supplier.tenant_id, ctx.tenantId)))

    if (!existingSupplier || existingSupplier.deletedAt) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Supplier not found.",
      })
    }

    const updatedData: Record<string, any> = {}
    if (input.contact_name !== undefined)
      updatedData.contact_name = input.contact_name
    if (input.phone !== undefined) updatedData.phone = input.phone
    if (input.address !== undefined) updatedData.address = input.address
    if (input.email !== undefined) updatedData.email = input.email
    if (input.delivery_days !== undefined)
      updatedData.delivery_days = input.delivery_days
    if (input.minimum_order_amount !== undefined)
      updatedData.minimum_order_amount = input.minimum_order_amount
    if (input.free_shipping_minimum !== undefined)
      updatedData.free_shipping_minimum = input.free_shipping_minimum
    if (input.shipping_fee !== undefined)
      updatedData.shipping_fee = input.shipping_fee
    if (input.supplier_type !== undefined)
      updatedData.supplier_type = input.supplier_type
    if (input.preferred_order_method !== undefined)
      updatedData.preferred_order_method = input.preferred_order_method
    if (input.notes !== undefined) updatedData.notes = input.notes

    if (Object.keys(updatedData).length === 0) {
      return { message: "Nothing to update." }
    }

    const [updatedSupplier] = await ctx.db
      .update(Supplier)
      .set(updatedData)
      .where(and(eq(Supplier.id, input.supplierId), eq(Supplier.tenant_id, ctx.tenantId)))
      .returning()

    return { message: "Supplier Updated", updatedSupplier }
  })
