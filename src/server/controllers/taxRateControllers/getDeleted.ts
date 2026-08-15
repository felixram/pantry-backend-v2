import { authedProcedure } from "../../trpc.ts";
import { TaxRate } from "../../../db/schema/taxRate.ts";
import { TaxRateAudit } from "../../../db/schema/taxRateAudit.ts";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { purgeExpiredDeletedTaxRates, TAX_RATE_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredTaxRates.ts";

export const getDeletedTaxRatesProcedure = authedProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
  }

  await purgeExpiredDeletedTaxRates(ctx.db);

  const cutoff = new Date(Date.now() - TAX_RATE_RESTORE_WINDOW_MS);

  const taxRates = await ctx.db.query.TaxRate.findMany({
    where: and(eq(TaxRate.tenant_id, ctx.tenantId), isNotNull(TaxRate.deletedAt), gte(TaxRate.deletedAt, cutoff)),
    columns: { id: true, name: true, deletedAt: true },
    orderBy: (taxRate) => [desc(taxRate.deletedAt)],
  });

  if (taxRates.length === 0) {
    return { taxRates: [] };
  }

  const deleteEvents = await ctx.db.query.TaxRateAudit.findMany({
    where: and(
      eq(TaxRateAudit.tenant_id, ctx.tenantId),
      inArray(TaxRateAudit.taxRateId, taxRates.map((taxRate) => taxRate.id)),
      eq(TaxRateAudit.action, "deleted")
    ),
    columns: { taxRateId: true, createdAt: true },
    with: { user: { columns: { name: true } } },
    orderBy: (auditRow) => [desc(auditRow.createdAt)],
  });

  const deletedByNameByTaxRateId = new Map<string, string>();
  for (const event of deleteEvents) {
    if (event.taxRateId && !deletedByNameByTaxRateId.has(event.taxRateId)) {
      deletedByNameByTaxRateId.set(event.taxRateId, event.user?.name || "Unknown User");
    }
  }

  return {
    taxRates: taxRates.map((taxRate) => ({
      ...taxRate,
      deletedByName: deletedByNameByTaxRateId.get(taxRate.id) ?? null,
    })),
  };
});
