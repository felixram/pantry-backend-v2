import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { ProductAudit } from "../../../db/schema/productAudit.ts";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/**
 * Tenant-wide product delete/restore history, newest first. Scoped via the
 * denormalized tenant_id (not a productId join) so entries for products
 * that have since been hard-purged still show up correctly.
 */
export const getProductAuditLogProcedure = authedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const logs = await ctx.db.query.ProductAudit.findMany({
      where: eq(ProductAudit.tenant_id, ctx.tenantId),
      columns: {
        id: true,
        productId: true,
        productName: true,
        productSku: true,
        action: true,
        reason: true,
        createdAt: true,
      },
      with: {
        user: { columns: { name: true } },
      },
      orderBy: desc(ProductAudit.createdAt),
      limit: input.limit,
      offset: input.offset,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        productId: log.productId,
        productName: log.productName,
        productSku: log.productSku,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt,
        userName: log.user?.name || "Unknown User",
      })),
    };
  });
