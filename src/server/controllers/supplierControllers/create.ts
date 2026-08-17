import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { Supplier } from "../../../db/schema/supplier.ts"
import { TRPCError } from "@trpc/server"

// adminMutation (elevated role) — suppliers are shared reference data;
// mutating them moved out of authedMutation so USER can no longer
// create/edit/delete/restore them, only browse (getAll/getById stay open).
export const createSupplierProcedure = adminMutation
  .input(
    z.object({
      name: z.string(),
      contact_name: z.string(),
      phone: z.string().optional(),
      email: z.union([z.email(), z.literal("")]).optional(),
      address: z.string().optional(),
      delivery_days: z.string().optional(),
      minimum_order_amount: z.coerce.number().optional(),
      free_shipping_minimum: z.coerce.number().optional(),
      shipping_fee: z.coerce.number().optional(),
      supplier_type: z.enum(["PRIMARY", "SECONDARY"]).default("PRIMARY"),
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

    const [supplier] = await ctx.db
      .insert(Supplier)
      .values({
        ...input,
        tenant_id: ctx.tenantId,
      })
      .returning()
    return { message: "Supplier successfully created!", supplier }
  })
