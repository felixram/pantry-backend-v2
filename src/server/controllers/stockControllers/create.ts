import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { Product } from "../../../db/schema/product.ts";
import { Location } from "../../../db/schema/location.ts";
import { eq, and } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { toBaseUnits } from "../../../utils/unitConversion.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";

export const createStock = authedMutation
  .input(
    z.object({
      product_id: z.string(),
      location_id: z.string(),
      qty: z.number().nonnegative().default(0),
      minimumStockLevel: z.number().nonnegative().optional(),
      parLevel: z.number().nonnegative().optional(),
      unit_name: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Tenant context required",
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

      // Validate location exists
      const location = await tx.query.Location.findFirst({
        where: and(eq(Location.id, input.location_id), eq(Location.tenant_id, ctx.tenantId!)),
      });

      if (!location) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Location not found",
        });
      }

      // Validate user has access to this location
      validateLocationAccess(ctx.user!, ctx.userLocationId, input.location_id);

      const { conversions, factor: conversionFactor } = await resolveUnitFactor(
        tx,
        input.product_id,
        ctx.tenantId!,
        input.unit_name,
      );

      const convert = (qty: number) =>
        input.unit_name ? toBaseUnits(qty, conversions, input.unit_name) : qty;

      const baseQty = convert(input.qty);
      const baseMinimum = input.minimumStockLevel != null ? convert(input.minimumStockLevel) : 0;
      const baseParLevel = input.parLevel != null ? convert(input.parLevel) : null;

      // Same par >= minimum rule enforced by setParLevel — reject inconsistent
      // levels at creation time too, not just on later updates.
      if (baseParLevel != null && baseParLevel < baseMinimum) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Par level cannot be less than minimum stock level",
        });
      }

      // Check if stock already exists for this product/location combination
      const existingStock = await tx.query.Stock.findFirst({
        where: and(
          eq(Stock.location_id, input.location_id),
          eq(Stock.productId, input.product_id),
          eq(Stock.tenant_id, ctx.tenantId!)
        ),
      });

      if (existingStock) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stock record already exists for this product at this location",
        });
      }

      // Create stock record — persist display unit if non-base unit was chosen
      const [newStock] = await tx
        .insert(Stock)
        .values({
          location_id: input.location_id,
          productId: input.product_id,
          qty: baseQty,
          minimumStockLevel: baseMinimum,
          parLevel: baseParLevel,
          display_unit: input.unit_name && conversionFactor !== 1 ? input.unit_name : null,
          tenant_id: ctx.tenantId!,
        })
        .returning();

      // Log initial stock movement
      const reason = input.unit_name && conversionFactor !== 1
        ? `Initial stock setup (${input.qty} ${input.unit_name} = ${baseQty} base units)`
        : "Initial stock setup";

      await tx.insert(StockMovement).values({
        product_id: input.product_id,
        location_id: input.location_id,
        change_qty: baseQty,
        movement_type: "INITIAL",
        reason,
        user_id: ctx.user!.id,
        tenant_id: ctx.tenantId!,
      });

      return {
        message: "Stock created successfully",
        stock: newStock,
      };
    });
  });
