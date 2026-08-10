import z from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Supplier } from "../../../db/schema/supplier.ts";
import { Product } from "../../../db/schema/product.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { eq, and, count } from "drizzle-orm";

export const getSupplierById = authedProcedure
  .input(
    z.object({
      id: z.string(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    const supplier = await ctx.db.query.Supplier.findFirst({
      where: and(eq(Supplier.id, input.id), eq(Supplier.tenant_id, ctx.tenantId)),
    });

    if (!supplier) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Supplier not found",
      });
    }

    // Get product count
    const [productCount] = await ctx.db
      .select({ count: count() })
      .from(Product)
      .where(and(eq(Product.supplier_id, input.id), eq(Product.tenant_id, ctx.tenantId)));

    // Get purchase order count
    const [poCount] = await ctx.db
      .select({ count: count() })
      .from(PurchaseOrder)
      .where(and(eq(PurchaseOrder.supplier_id, input.id), eq(PurchaseOrder.tenant_id, ctx.tenantId)));

    return {
      ...supplier,
      product_count: productCount?.count || 0,
      purchase_order_count: poCount?.count || 0,
    };
  });
