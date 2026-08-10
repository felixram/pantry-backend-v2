import { authedProcedure } from "../../trpc.ts";
import { Supplier } from "../../../db/schema/supplier.ts";
import { SupplierAudit } from "../../../db/schema/supplierAudit.ts";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { purgeExpiredDeletedSuppliers, SUPPLIER_RESTORE_WINDOW_MS } from "./helpers/purgeExpiredSuppliers.ts";

export const getDeletedSuppliersProcedure = authedProcedure.query(async ({ ctx }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
  }

  await purgeExpiredDeletedSuppliers(ctx.db);

  const cutoff = new Date(Date.now() - SUPPLIER_RESTORE_WINDOW_MS);

  const suppliers = await ctx.db.query.Supplier.findMany({
    where: and(eq(Supplier.tenant_id, ctx.tenantId), isNotNull(Supplier.deletedAt), gte(Supplier.deletedAt, cutoff)),
    columns: { id: true, name: true, deletedAt: true },
    orderBy: (supplier) => [desc(supplier.deletedAt)],
  });

  if (suppliers.length === 0) {
    return { suppliers: [] };
  }

  const deleteEvents = await ctx.db.query.SupplierAudit.findMany({
    where: and(
      eq(SupplierAudit.tenant_id, ctx.tenantId),
      inArray(SupplierAudit.supplierId, suppliers.map((supplier) => supplier.id)),
      eq(SupplierAudit.action, "deleted")
    ),
    columns: { supplierId: true, createdAt: true },
    with: { user: { columns: { name: true } } },
    orderBy: (auditRow) => [desc(auditRow.createdAt)],
  });

  const deletedByNameBySupplierId = new Map<string, string>();
  for (const event of deleteEvents) {
    if (event.supplierId && !deletedByNameBySupplierId.has(event.supplierId)) {
      deletedByNameBySupplierId.set(event.supplierId, event.user?.name || "Unknown User");
    }
  }

  return {
    suppliers: suppliers.map((supplier) => ({
      ...supplier,
      deletedByName: deletedByNameBySupplierId.get(supplier.id) ?? null,
    })),
  };
});
