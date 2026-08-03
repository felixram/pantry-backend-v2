import { eq } from "drizzle-orm"
import { TenantInvoiceConfig } from "../../../db/schema/tenantInvoiceConfig.ts"
import { adminMutation } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"

export const updateInvoiceConfigProcedure = adminMutation
  .input(
    z.object({
      allowed_sender_domains: z.array(z.string().min(1)).optional(),
      auto_match_enabled: z.boolean().optional(),
      require_po_match: z.boolean().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const existing = await ctx.db.query.TenantInvoiceConfig.findFirst({
      where: eq(TenantInvoiceConfig.tenant_id, ctx.tenantId),
    })

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invoice configuration not found for this tenant",
      })
    }

    const updateData: Record<string, unknown> = {}
    if (input.allowed_sender_domains !== undefined) {
      updateData.allowed_sender_domains = input.allowed_sender_domains
    }
    if (input.auto_match_enabled !== undefined) {
      updateData.auto_match_enabled = input.auto_match_enabled
    }
    if (input.require_po_match !== undefined) {
      updateData.require_po_match = input.require_po_match
    }

    if (Object.keys(updateData).length === 0) {
      return { message: "No changes to apply" }
    }

    await ctx.db
      .update(TenantInvoiceConfig)
      .set(updateData)
      .where(eq(TenantInvoiceConfig.id, existing.id))

    return { message: "Invoice configuration updated" }
  })
