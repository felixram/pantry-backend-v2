import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { Product } from "../../../db/schema/product.ts";
import { ProductAudit } from "../../../db/schema/productAudit.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { PurchaseOrderItem } from "../../../db/schema/purchaseOrderItem.ts";
import { and, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ROLES } from "../../../types/user.ts";
import { TERMINAL_STATES } from "../../../types/orders.ts";

export const deleteProductProcedure = adminMutation
  .input(
    z.object({
      productId: z.uuid(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Only full admins can delete products
    if (ctx.user!.role !== ROLES.admin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only administrators can delete products",
      });
    }

    // Tenant-scoped existence check — also makes this idempotent-safe:
    // deleting an already-deleted (or another tenant's) product now 404s
    // instead of silently "succeeding" again.
    const existingProduct = await ctx.db.query.Product.findFirst({
      where: and(eq(Product.id, input.productId), eq(Product.tenant_id, ctx.tenantId), isNull(Product.deletedAt)),
      columns: { id: true, name: true, sku: true },
    });

    if (!existingProduct) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Product not found.",
      });
    }

    // Block deletion of a product that's still actively in use, rather than
    // silently hiding it out from under existing stock/orders (v1 has no
    // such check at all).
    const stockWithQty = await ctx.db
      .select({ id: Stock.id })
      .from(Stock)
      .where(
        and(
          eq(Stock.productId, input.productId),
          eq(Stock.tenant_id, ctx.tenantId),
          isNull(Stock.deletedAt),
          gt(Stock.qty, 0)
        )
      );

    if (stockWithQty.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot delete this product — it has stock on hand at ${stockWithQty.length} location${stockWithQty.length === 1 ? "" : "s"}. Adjust stock to zero first.`,
      });
    }

    const items = await ctx.db.query.PurchaseOrderItem.findMany({
      where: and(eq(PurchaseOrderItem.product_id, input.productId), isNull(PurchaseOrderItem.deletedAt)),
      columns: { id: true },
      with: {
        purchaseOrder: {
          columns: { status: true, tenant_id: true, deletedAt: true },
        },
      },
    });

    const activeOrderCount = items.filter(
      (item) =>
        item.purchaseOrder &&
        item.purchaseOrder.tenant_id === ctx.tenantId &&
        !item.purchaseOrder.deletedAt &&
        !TERMINAL_STATES.includes(item.purchaseOrder.status as (typeof TERMINAL_STATES)[number])
    ).length;

    if (activeOrderCount > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot delete this product — it's on ${activeOrderCount} active purchase order${activeOrderCount === 1 ? "" : "s"}. Cancel or complete them first.`,
      });
    }

    await ctx.db.transaction(async (tx) => {
      await tx.update(Product).set({ deletedAt: new Date() }).where(eq(Product.id, input.productId));
      await tx.insert(ProductAudit).values({
        productId: input.productId,
        productName: existingProduct.name,
        productSku: existingProduct.sku,
        tenant_id: ctx.tenantId!,
        action: "deleted",
        userId: ctx.user!.id,
      });
    });

    return { message: "Product deleted successfully." };
  });
