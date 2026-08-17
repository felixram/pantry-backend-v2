import { and, eq, isNull } from "drizzle-orm"
import { Invoice } from "../../../db/schema/invoice.ts"
import { authedProcedure } from "../../trpc.ts"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { getSignedUrl } from "../../../services/storage/r2Client.ts"
import { validateLocationAccess } from "../../../utils/locationFilter.ts"

export const getFileUrlProcedure = authedProcedure
  .input(z.object({ invoiceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    const invoice = await ctx.db.query.Invoice.findFirst({
      where: and(
        eq(Invoice.id, input.invoiceId),
        eq(Invoice.tenant_id, ctx.tenantId),
        isNull(Invoice.deletedAt)
      ),
    })

    if (!invoice) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invoice not found",
      })
    }

    if (invoice.location_id) {
      validateLocationAccess(ctx.user!, ctx.userLocationId, invoice.location_id)
    }

    if (!invoice.original_file_url) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No file associated with this invoice",
      })
    }

    const url = await getSignedUrl(invoice.original_file_url, ctx.tenantId)

    if (!url) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to generate file URL. Storage may not be configured.",
      })
    }

    return {
      url,
      filename: invoice.original_file_name,
      contentType: invoice.original_file_type,
    }
  })
