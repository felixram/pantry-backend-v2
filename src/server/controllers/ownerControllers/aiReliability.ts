import { z } from "zod"
import { and, count, eq, gte, isNull, sql } from "drizzle-orm"
import { ownerProcedure } from "../../trpc.ts"
import { UsageEvent } from "../../../db/schema/usageEvent.ts"
import { Tenant } from "../../../db/schema/tenant.ts"
import { Invoice } from "../../../db/schema/invoice.ts"
import {
  AI_EXTRACTION_ERROR_TYPES,
  USAGE_EVENT_TYPE,
  type AiExtractionErrorType,
} from "../../../types/usage.ts"
import { INVOICE_STATUS } from "../../../types/invoice.ts"

type ErrorBreakdown = Record<AiExtractionErrorType, number>

function emptyBreakdown(): ErrorBreakdown {
  return Object.fromEntries(AI_EXTRACTION_ERROR_TYPES.map((k) => [k, 0])) as ErrorBreakdown
}

function normalizeErrorType(raw: unknown): AiExtractionErrorType {
  return AI_EXTRACTION_ERROR_TYPES.includes(raw as AiExtractionErrorType)
    ? (raw as AiExtractionErrorType)
    : "OTHER"
}

function rate(failed: number, ok: number): number {
  const total = failed + ok
  return total === 0 ? 0 : failed / total
}

// Cross-tenant AI-extraction reliability for the owner console — same
// deliberate no-tenant-scoping as usageSummary.ts, gated on ownerProcedure.
export const aiReliability = ownerProcedure
  .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
  .query(async ({ ctx, input }) => {
    const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

    // 1. OK / FAILED outcome counts per tenant, from the usage_event ledger.
    const outcomeRows = await ctx.db
      .select({
        tenantId: UsageEvent.tenant_id,
        tenantName: Tenant.name,
        eventType: UsageEvent.eventType,
        eventCount: count(UsageEvent.id),
      })
      .from(UsageEvent)
      .innerJoin(Tenant, eq(UsageEvent.tenant_id, Tenant.id))
      .where(
        and(
          gte(UsageEvent.createdAt, since),
          sql`${UsageEvent.eventType} in (${USAGE_EVENT_TYPE.ai_invoice_extraction_ok}, ${USAGE_EVENT_TYPE.ai_invoice_extraction_failed})`,
        ),
      )
      .groupBy(UsageEvent.tenant_id, Tenant.name, UsageEvent.eventType)

    // 2. errorType breakdown for FAILED rows (tiny volume — one row per
    //    failed extraction call).
    const errorRows = await ctx.db
      .select({
        tenantId: UsageEvent.tenant_id,
        errorType: sql<string>`${UsageEvent.metadata} ->> 'errorType'`,
        eventCount: count(UsageEvent.id),
      })
      .from(UsageEvent)
      .where(
        and(
          gte(UsageEvent.createdAt, since),
          eq(UsageEvent.eventType, USAGE_EVENT_TYPE.ai_invoice_extraction_failed),
        ),
      )
      .groupBy(UsageEvent.tenant_id, sql`${UsageEvent.metadata} ->> 'errorType'`)

    // 3. Invoices sitting in FAILED right now, per tenant.
    const failedInvoiceRows = await ctx.db
      .select({
        tenantId: Invoice.tenant_id,
        failedCount: count(Invoice.id),
      })
      .from(Invoice)
      .where(and(eq(Invoice.status, INVOICE_STATUS.failed), isNull(Invoice.deletedAt)))
      .groupBy(Invoice.tenant_id)

    const currentlyFailedByTenant = new Map(
      failedInvoiceRows.map((r) => [r.tenantId, Number(r.failedCount)]),
    )
    const breakdownByTenant = new Map<string, ErrorBreakdown>()
    for (const r of errorRows) {
      const b = breakdownByTenant.get(r.tenantId) ?? emptyBreakdown()
      b[normalizeErrorType(r.errorType)] += Number(r.eventCount)
      breakdownByTenant.set(r.tenantId, b)
    }

    const byTenantMap = new Map<
      string,
      { tenantId: string; tenantName: string; ok: number; failed: number }
    >()
    for (const r of outcomeRows) {
      const entry =
        byTenantMap.get(r.tenantId) ??
        { tenantId: r.tenantId, tenantName: r.tenantName, ok: 0, failed: 0 }
      if (r.eventType === USAGE_EVENT_TYPE.ai_invoice_extraction_ok) {
        entry.ok += Number(r.eventCount)
      } else {
        entry.failed += Number(r.eventCount)
      }
      byTenantMap.set(r.tenantId, entry)
    }
    // Tenants with a currently-failed invoice but no outcome rows in the
    // window still deserve a line.
    for (const [tenantId, failedCount] of currentlyFailedByTenant) {
      if (!byTenantMap.has(tenantId) && failedCount > 0) {
        const t = await ctx.db.query.Tenant.findFirst({
          where: eq(Tenant.id, tenantId),
          columns: { name: true },
        })
        byTenantMap.set(tenantId, {
          tenantId,
          tenantName: t?.name ?? "Unknown tenant",
          ok: 0,
          failed: 0,
        })
      }
    }

    const byTenant = [...byTenantMap.values()]
      .map((t) => ({
        ...t,
        failureRate: rate(t.failed, t.ok),
        currentlyFailed: currentlyFailedByTenant.get(t.tenantId) ?? 0,
        errorBreakdown: breakdownByTenant.get(t.tenantId) ?? emptyBreakdown(),
      }))
      .sort((a, b) => b.failureRate - a.failureRate || a.tenantName.localeCompare(b.tenantName))

    const totalOk = byTenant.reduce((s, t) => s + t.ok, 0)
    const totalFailed = byTenant.reduce((s, t) => s + t.failed, 0)
    const totalCurrentlyFailed = [...currentlyFailedByTenant.values()].reduce((s, n) => s + n, 0)

    return {
      since: since.toISOString(),
      days: input.days,
      overall: {
        ok: totalOk,
        failed: totalFailed,
        failureRate: rate(totalFailed, totalOk),
        currentlyFailed: totalCurrentlyFailed,
      },
      byTenant,
    }
  })
