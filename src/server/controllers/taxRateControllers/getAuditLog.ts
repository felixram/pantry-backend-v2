import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TaxRateAudit } from "../../../db/schema/taxRateAudit.ts";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const getTaxRateAuditLogProcedure = authedProcedure
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

    const logs = await ctx.db.query.TaxRateAudit.findMany({
      where: eq(TaxRateAudit.tenant_id, ctx.tenantId),
      columns: { id: true, taxRateId: true, taxRateName: true, action: true, reason: true, createdAt: true },
      with: { user: { columns: { name: true } } },
      orderBy: desc(TaxRateAudit.createdAt),
      limit: input.limit,
      offset: input.offset,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        taxRateId: log.taxRateId,
        taxRateName: log.taxRateName,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt,
        userName: log.user?.name || "Unknown User",
      })),
    };
  });
