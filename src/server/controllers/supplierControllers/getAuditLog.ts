import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { SupplierAudit } from "../../../db/schema/supplierAudit.ts";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const getSupplierAuditLogProcedure = authedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const logs = await ctx.db.query.SupplierAudit.findMany({
      where: eq(SupplierAudit.tenant_id, ctx.tenantId),
      columns: { id: true, supplierId: true, supplierName: true, action: true, reason: true, createdAt: true },
      with: { user: { columns: { name: true } } },
      orderBy: desc(SupplierAudit.createdAt),
      limit: input.limit,
      offset: input.offset,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        supplierId: log.supplierId,
        supplierName: log.supplierName,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt,
        userName: log.user?.name || "Unknown User",
      })),
    };
  });
