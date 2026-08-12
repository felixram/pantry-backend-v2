import z from "zod";
import { adminMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { Product } from "../../../db/schema/product.ts";
import { Location } from "../../../db/schema/location.ts";
import { eq, and, sql } from "drizzle-orm";
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
        where: and(eq(Product.id, input.product_id), eq(Product.tenant_id, ctx.tenantId!)),
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      // Validate both locations exist
      const fromLocation = await tx.query.Location.findFirst({
        where: and(eq(Location.id, input.from_location_id), eq(Location.tenant_id, ctx.tenantId!)),
      });

      const toLocation = await tx.query.Location.findFirst({
        where: and(eq(Location.id, input.to_location_id), eq(Location.tenant_id, ctx.tenantId!)),
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
          eq(Stock.productId, input.product_id),
          eq(Stock.tenant_id, ctx.tenantId!)
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

      // Atomic conditional decrement — closes the same lost-update race as
      // adjustStock (two concurrent transfers/adjustments against the same
      // source row could otherwise both read enough qty and the second
      // write would silently clobber the first).
      const [updatedFrom] = await tx
        .update(Stock)
        .set({ qty: sql`${Stock.qty} - ${input.qty}` })
        .where(
          and(
            eq(Stock.id, fromStock.id),
            eq(Stock.tenant_id, ctx.tenantId!),
            sql`${Stock.qty} - ${input.qty} >= 0`
          )
        )
        .returning();

      if (!updatedFrom) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient stock at source. Available: ${fromStock.qty}, requested: ${input.qty}`,
        });
      }

      // Log movement from source (negative quantity)
      await tx.insert(StockMovement).values({
        product_id: input.product_id,
        location_id: input.from_location_id,
        change_qty: -input.qty,
        movement_type: "TRANSFER_OUT",
        reason: `Transfer to ${toLocation.name}: ${input.reason}`,
        user_id: ctx.user!.id,
        tenant_id: ctx.tenantId!,
      });

      // Atomic upsert at destination — one statement handles both "existing
      // stock row, increment it" and "no row yet, create it," closing the
      // same pre-check-then-insert race createStock has (two concurrent
      // transfers into a location with no prior stock for this product
      // could otherwise both pass a "not found" check and collide on the
      // (location_id, productId) unique constraint). On first creation,
      // display_unit is copied from the source (a display preference, not
      // a policy); minimumStockLevel/parLevel/expectedUsage are left null
      // rather than defaulted to 0 — those are per-location policy
      // decisions that shouldn't silently inherit or silently disable
      // low-stock alerting at the new location. On conflict (row already
      // existed), only qty is touched — an existing destination's own
      // policy fields are never overwritten by a transfer.
      const [toStock] = await tx
        .insert(Stock)
        .values({
          location_id: input.to_location_id,
          productId: input.product_id,
          qty: input.qty,
          display_unit: fromStock.display_unit,
          tenant_id: ctx.tenantId!,
        })
        .onConflictDoUpdate({
          target: [Stock.location_id, Stock.productId],
          set: { qty: sql`${Stock.qty} + ${input.qty}` },
        })
        .returning();

      // Log movement to destination (positive quantity)
      await tx.insert(StockMovement).values({
        product_id: input.product_id,
        location_id: input.to_location_id,
        change_qty: input.qty,
        movement_type: "TRANSFER_IN",
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
        new_from_qty: updatedFrom.qty,
        new_to_qty: toStock?.qty ?? input.qty,
      };
    });
  });
