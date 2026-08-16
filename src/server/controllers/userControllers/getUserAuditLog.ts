import z from "zod"
import { adminProcedure } from "../../trpc.ts"
import { UserAudit } from "../../../db/schema/userAudit.ts"
import { ROLES } from "../../../types/user.ts"
import { and, desc, eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"

/**
 * Hard-delete history for the Users page's "Deletion History" dialog.
 * MANAGER only sees deletions scoped to their own location (same principle
 * as getPendingInvitations/resendInvitation/revokeInvitation) — ADMIN sees
 * the full tenant.
 */
export const getUserAuditLogProcedure = adminProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" })
    }

    const where =
      ctx.user!.role === ROLES.manager
        ? and(eq(UserAudit.tenant_id, ctx.tenantId), eq(UserAudit.targetLocationId, ctx.userLocationId ?? ""))
        : eq(UserAudit.tenant_id, ctx.tenantId)

    const logs = await ctx.db.query.UserAudit.findMany({
      where,
      columns: { id: true, targetEmail: true, targetName: true, reason: true, createdAt: true },
      with: { actor: { columns: { name: true } } },
      orderBy: desc(UserAudit.createdAt),
      limit: input.limit,
      offset: input.offset,
    })

    return {
      logs: logs.map((log) => ({
        id: log.id,
        targetEmail: log.targetEmail,
        targetName: log.targetName,
        reason: log.reason,
        createdAt: log.createdAt,
        actorName: log.actor?.name || "Unknown User",
      })),
    }
  })
