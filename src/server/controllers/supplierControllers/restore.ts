import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { SupplierAudit } from "../../../db/schema/supplierAudit.ts";
import { and, eq, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { SUPPLIER_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredSuppliers.ts";

export const restoreSupplierProcedure = adminMutation
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const supplier = await ctx.db.query.Supplier.findFirst({
      where: and(eq(Supplier.id, input.id), eq(Supplier.tenant_id, ctx.tenantId), isNotNull(Supplier.deletedAt)),
      columns: { id: true, name: true, deletedAt: true },
    });

    if (!supplier) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Deleted supplier not found." });
    }

    const deletedAt = supplier.deletedAt as Date;
    if (Date.now() - deletedAt.getTime() > SUPPLIER_RESTORE_WINDOW_MS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This supplier's recovery window has expired and it can no longer be restored.",
      });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(Supplier).set({ deletedAt: null }).where(eq(Supplier.id, input.id));
      await tx.insert(SupplierAudit).values({
        supplierId: input.id,
        supplierName: supplier.name,
        tenant_id: ctx.tenantId!,
        action: "restored",
        userId: ctx.user!.id,
      });
    });

    return { message: "Supplier restored successfully." };
  });
