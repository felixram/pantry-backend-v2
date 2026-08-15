import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TaxRate } from "../../../db/schema/taxRate.ts";
import { TaxRateAudit } from "../../../db/schema/taxRateAudit.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { TAX_RATE_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredTaxRates.ts";

export const restoreTaxRateProcedure = adminMutation
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const taxRate = await ctx.db.query.TaxRate.findFirst({
      where: and(eq(TaxRate.id, input.id), eq(TaxRate.tenant_id, ctx.tenantId), isNotNull(TaxRate.deletedAt)),
      columns: { id: true, name: true, deletedAt: true },
    });

    if (!taxRate) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Deleted tax rate not found." });
    }

    const deletedAt = taxRate.deletedAt as Date;
    if (Date.now() - deletedAt.getTime() > TAX_RATE_RESTORE_WINDOW_MS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This tax rate's recovery window has expired and it can no longer be restored.",
      });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(TaxRate).set({ deletedAt: null }).where(eq(TaxRate.id, input.id));
      await tx.insert(TaxRateAudit).values({
        taxRateId: input.id,
        taxRateName: taxRate.name,
        tenant_id: ctx.tenantId!,
        action: "restored",
        userId: ctx.user!.id,
      });
    });

    return { message: "Tax rate restored successfully." };
  });
