import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { Product } from "../../../db/schema/product.ts";
import { Location } from "../../../db/schema/location.ts";
import { eq, and } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { ROLES } from "../../../types/user.ts";

export const transferStock = adminMutation
  .input(
    z.object({
      product_id: z.string(),
      from_location_id: z.string(),
      to_location_id: z.string(),
      qty: z.number().positive(),
      reason: z.string().min(3, "Reason must be at least 3 characters"),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
      });
    }

    // Stock transfers require full admin access (cross-location operation)
    if (ctx.user!.role === ROLES.manager) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Stock transfers between locations require admin access",
      });
    }

    // Validate not transferring to same location
    if (input.from_location_id === input.to_location_id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot transfer to the same location",
      });
    }

    return await ctx.db.transaction(async (tx) => {
      // Validate product exists
      const product = await tx.query.Product.findFirst({
        where: eq(Product.id, input.product_id),
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      // Validate both locations exist
      const fromLocation = await tx.query.Location.findFirst({
        where: eq(Location.id, input.from_location_id),
      });

      const toLocation = await tx.query.Location.findFirst({
        where: eq(Location.id, input.to_location_id),
      });

      if (!fromLocation || !toLocation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or both locations not found",
        });
      }

      // Validate user has access to both locations (currently admin-only, but validates for consistency)
      validateLocationAccess(ctx.user!, ctx.userLocationId, input.from_location_id);
      validateLocationAccess(ctx.user!, ctx.userLocationId, input.to_location_id);

      // Get source stock
      const fromStock = await tx.query.Stock.findFirst({
        where: and(
          eq(Stock.location_id, input.from_location_id),
          eq(Stock.productId, input.product_id)
        ),
      });

      if (!fromStock) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No stock found at source location",
        });
      }

      if (fromStock.deletedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer from archived stock. Restore it first.",
        });
      }

      // Validate sufficient stock at source
      if (fromStock.qty < input.qty) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient stock at source. Available: ${fromStock.qty}, requested: ${input.qty}`,
        });
      }

      // Decrease stock at source location
      const newFromQty = fromStock.qty - input.qty;
      await tx
        .update(Stock)
        .set({ qty: newFromQty })
        .where(eq(Stock.id, fromStock.id));

      // Log movement from source (negative quantity)
      await tx.insert(StockMovement).values({
        product_id: input.product_id,
        location_id: input.from_location_id,
        change_qty: -input.qty,
        reason: `Transfer to ${toLocation.name}: ${input.reason}`,
        user_id: ctx.user!.id,
        tenant_id: ctx.tenantId!,
      });

      // Check if stock exists at destination
      const toStock = await tx.query.Stock.findFirst({
        where: and(
          eq(Stock.location_id, input.to_location_id),
          eq(Stock.productId, input.product_id)
        ),
      });

      if (toStock) {
        // Update existing stock at destination
        const newToQty = toStock.qty + input.qty;
        await tx.update(Stock).set({ qty: newToQty }).where(eq(Stock.id, toStock.id));
      } else {
        // Create new stock record at destination
        await tx.insert(Stock).values({
          location_id: input.to_location_id,
          productId: input.product_id,
          qty: input.qty,
          minimumStockLevel: 0,
          tenant_id: ctx.tenantId!,
        });
      }

      // Log movement to destination (positive quantity)
      await tx.insert(StockMovement).values({
        product_id: input.product_id,
        location_id: input.to_location_id,
        change_qty: input.qty,
        reason: `Transfer from ${fromLocation.name}: ${input.reason}`,
        user_id: ctx.user!.id,
        tenant_id: ctx.tenantId!,
      });

      return {
        message: "Stock transferred successfully",
        product_id: input.product_id,
        from_location: fromLocation.name,
        to_location: toLocation.name,
        qty_transferred: input.qty,
        new_from_qty: newFromQty,
        new_to_qty: toStock ? toStock.qty + input.qty : input.qty,
      };
    });
  });
