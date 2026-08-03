import z from "zod"
import { authedProcedure } from "../../trpc.ts"
import { PurchaseOrderAudit } from "../../../db/schema/purchaseOrder_audit_log.ts"
import { User } from "../../../db/schema/users.ts"
import { eq, desc } from "drizzle-orm"

export const getPurchaseOrderAuditLog = authedProcedure
  .input(
    z.object({
      purchaseOrderId: z.string(),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    })
  )
  .mutation(async ({ ctx, input }) => {
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
