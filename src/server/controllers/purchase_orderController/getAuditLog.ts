import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { TRPCError } from "@trpc/server"
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts"
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts"
import { User } from "../../../db/schema/users.ts"
import { and, eq, desc } from "drizzle-orm"

export const getPurchaseOrderAuditLog = authedProcedure
  .input(
    z.object({
      purchaseOrderId: z.string(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      })
    }

    // Verify the PO belongs to the caller's tenant before returning any of
    // its audit history — this endpoint previously had no ownership check
    // of any kind, letting any authenticated user page through any other
    // tenant's full audit trail by guessing a purchaseOrderId.
    const purchaseOrder = await ctx.db.query.PurchaseOrder.findFirst({
      where: and(eq(PurchaseOrder.id, input.purchaseOrderId), eq(PurchaseOrder.tenant_id, ctx.tenantId)),
      columns: { id: true },
    })

    if (!purchaseOrder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Purchase order not found",
      })
    }

    const auditLogs = await ctx.db.query.PurchaseOrderAudit.findMany({
      where: eq(PurchaseOrderAudit.purchaseOrderId, input.purchaseOrderId),
      with: {
        user: true,
      },
      orderBy: desc(PurchaseOrderAudit.createdAt),
      limit: input.limit,
      offset: input.offset,
    })

    return {
      logs: auditLogs.map((log) => ({
        id: log.id,
        fieldChanged: log.fieldChanged,
        oldValue: log.oldValue,
        newValue: log.newValue,
        reason: log.reason,
        createdAt: log.createdAt,
        userId: log.userId,
        userName: log.user?.name || "Unknown User",
      })),
      total: auditLogs.length,
    }
  })
