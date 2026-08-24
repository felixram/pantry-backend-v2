import { z } from "zod"
import { eq, gte, sum, count } from "drizzle-orm"
import { ownerProcedure } from "../../trpc.ts"
import { UsageEvent } from "../../../db/schema/usageEvent.ts"
import { Tenant } from "../../../db/schema/tenant.ts"

// Deliberately NOT tenant-scoped — this is the one place in the app that
// intentionally reads across every tenant at once, gated on ownerProcedure
// instead of a tenant's own ADMIN role. See resolveOwnerContext.ts.
export const usageSummary = ownerProcedure
  .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
  .query(async ({ ctx, input }) => {
    const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

    const rows = await ctx.db
      .select({
        tenantId: UsageEvent.tenant_id,
        tenantName: Tenant.name,
        eventType: UsageEvent.eventType,
        totalQuantity: sum(UsageEvent.quantity),
        totalCostEstimate: sum(UsageEvent.costEstimate),
        eventCount: count(UsageEvent.id),
      })
      .from(UsageEvent)
      .innerJoin(Tenant, eq(UsageEvent.tenant_id, Tenant.id))
      .where(gte(UsageEvent.createdAt, since))
      .groupBy(UsageEvent.tenant_id, Tenant.name, UsageEvent.eventType)
      .orderBy(Tenant.name, UsageEvent.eventType)

    return {
      since: since.toISOString(),
      days: input.days,
      rows: rows.map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        eventType: r.eventType,
        totalQuantity: Number(r.totalQuantity ?? 0),
        totalCostEstimate: r.totalCostEstimate === null ? null : Number(r.totalCostEstimate),
        eventCount: Number(r.eventCount),
      })),
    }
  })
