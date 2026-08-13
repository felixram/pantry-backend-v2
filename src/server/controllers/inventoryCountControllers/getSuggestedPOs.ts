import { z } from "zod";
import { authedProcedure } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { InventoryCountSession, INVENTORY_COUNT_STATUS } from "../../../db/schema/inventoryCountSession.ts";
import { Stock } from "../../../db/schema/stock.ts";
import { PurchaseOrder } from "../../../db/schema/purchaseOrder.ts";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { priceInUnit, tryGetFactor } from "../../../utils/unitConversion.ts";

export const getSuggestedPOs = authedProcedure
  .input(
    z.object({
      session_id: z.string().uuid(),
      location_id: z.string().uuid(),
    })
  )
  .query(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    validateLocationAccess(ctx.user!, ctx.userLocationId, input.location_id);

    // Verify session exists, belongs to tenant, and is COMPLETED
    const session = await ctx.db.query.InventoryCountSession.findFirst({
      where: and(
        eq(InventoryCountSession.id, input.session_id),
        eq(InventoryCountSession.tenant_id, ctx.tenantId),
      ),
    });

    if (!session) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Count session not found" });
    }

    if (session.status !== INVENTORY_COUNT_STATUS.completed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Count session must be completed before generating PO suggestions",
      });
    }

    // Suppliers that already got a PO from this session — excluded below
    // from the orderable suggestions and reported separately, so a revisit
    // (partial creation, stale link, etc.) only ever offers what's actually
    // still outstanding instead of either blocking everything or offering
    // duplicates.
    const existingPOs = await ctx.db.query.PurchaseOrder.findMany({
      where: and(
        eq(PurchaseOrder.source_count_session_id, input.session_id),
        eq(PurchaseOrder.tenant_id, ctx.tenantId),
        isNull(PurchaseOrder.deletedAt),
      ),
      columns: { id: true, po_number: true, supplier_id: true },
      with: {
        supplier: { columns: { id: true, name: true } },
      },
    });
    const alreadyOrdered = existingPOs
      .filter((po) => po.supplier_id !== null)
      .map((po) => ({
        supplier_id: po.supplier_id!,
        supplier_name: po.supplier?.name ?? "Unknown supplier",
        purchaseOrderId: po.id,
        poNumber: po.po_number,
      }));
    const alreadyOrderedSupplierIds = new Set(alreadyOrdered.map((a) => a.supplier_id));

    // Query low-stock items with par levels at this location
    const lowStockItems = await ctx.db.query.Stock.findMany({
      where: and(
        eq(Stock.tenant_id, ctx.tenantId),
        eq(Stock.location_id, input.location_id),
        sql`(${Stock.qty} - COALESCE(${Stock.expectedUsage}, 0)) <= ${Stock.minimumStockLevel}`,
        isNotNull(Stock.parLevel),
        isNull(Stock.deletedAt),
      ),
      with: {
        product: {
          columns: { id: true, name: true, sku: true, supplier_id: true, defaultUnit: true, unit: true },
          with: {
            supplier: { columns: { id: true, name: true } },
            version: { columns: { costPrice: true, costPriceUnit: true } },
            unitConversions: true,
          },
        },
      },
    });

    // Also find items below minimum but missing par level or supplier (for skipped list)
    const itemsMissingParLevel = await ctx.db.query.Stock.findMany({
      where: and(
        eq(Stock.tenant_id, ctx.tenantId),
        eq(Stock.location_id, input.location_id),
        sql`(${Stock.qty} - COALESCE(${Stock.expectedUsage}, 0)) <= ${Stock.minimumStockLevel}`,
        isNotNull(Stock.minimumStockLevel),
        isNull(Stock.parLevel),
        isNull(Stock.deletedAt),
      ),
      with: {
        product: { columns: { id: true, name: true } },
      },
    });

    type SupplierGroup = {
      supplier_id: string;
      supplier_name: string;
      items: Array<{
        product_id: string;
        product_name: string;
        sku: string | null;
        current_qty: number;
        projected_qty: number;
        expected_usage: number;
        par_level: number;
        minimum_level: number;
        order_qty: number;
        unit_price: number;
        unit: string | null;
        available_units: string[];
      }>;
    };

    const supplierMap = new Map<string, SupplierGroup>();
    const skipped: Array<{ product_name: string; reason: "no_supplier" | "no_par_level" }> = [];

    for (const stock of lowStockItems) {
      if (!stock.product) continue;

      const projectedQty = stock.qty - (stock.expectedUsage ?? 0);
      const rawOrderQty = (stock.parLevel ?? 0) - projectedQty;
      if (rawOrderQty <= 0) continue;

      if (!stock.product.supplier_id || !stock.product.supplier) {
        skipped.push({ product_name: stock.product.name, reason: "no_supplier" });
        continue;
      }

      if (alreadyOrderedSupplierIds.has(stock.product.supplier_id)) {
        continue;
      }

      // Pick the best purchasable unit. Prefer the largest unit that divides
      // evenly into the needed qty, so we suggest "1 Case" instead of "12 Sleeves".
      // If nothing divides evenly, use the smallest unit to minimize overshoot.
      const purchasableUnits = (stock.product.unitConversions ?? [])
        .filter((uc) => uc.is_purchasable)
        .sort((a, b) => a.conversion_factor - b.conversion_factor);

      let orderUnit: string | null = null;
      let orderQty: number;
      let convFactor = 1;

      if (purchasableUnits.length > 0) {
        const roundedBase = Math.ceil(rawOrderQty);

        // First pass: find the largest unit that divides evenly into the rounded need
        let bestUnit: typeof purchasableUnits[number] | null = null;
        for (let i = purchasableUnits.length - 1; i >= 0; i--) {
          const uc = purchasableUnits[i]!;
          if (roundedBase % uc.conversion_factor === 0) {
            bestUnit = uc;
            break;
          }
        }

        // Second pass: if nothing divides evenly, pick the smallest unit
        // to minimize overshoot
        if (!bestUnit) {
          bestUnit = purchasableUnits[0]!;
        }

        orderUnit = bestUnit.unit_name;
        convFactor = bestUnit.conversion_factor;
        orderQty = Math.ceil(rawOrderQty / convFactor);
      } else {
        // No purchasable units defined — use display/default unit
        orderUnit = stock.display_unit ?? stock.product.defaultUnit ?? null;
        const fallbackConv = orderUnit
          ? stock.product.unitConversions?.find((uc) => uc.unit_name === orderUnit)
          : null;
        convFactor = fallbackConv?.conversion_factor ?? 1;
        orderQty = Math.ceil(rawOrderQty / convFactor);
      }

      // Convert cost price to per-order-unit price via the canonical helper.
      // Fallback for the rare case where orderUnit isn't in conversions
      // (e.g. legacy display_unit values): scale by the factor we already
      // derived above, which preserves prior behavior.
      const costPrice = stock.product.version?.costPrice ?? 0;
      const costPriceUnit = stock.product.version?.costPriceUnit ?? null;
      const conversions = stock.product.unitConversions ?? [];
      const unitPrice = orderUnit && tryGetFactor(conversions, orderUnit) !== undefined
        ? priceInUnit({ price: costPrice, fromUnit: costPriceUnit, toUnit: orderUnit, conversions })
        : costPrice * convFactor;

      const supplierId = stock.product.supplier_id;
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplier_id: supplierId,
          supplier_name: stock.product.supplier.name,
          items: [],
        });
      }

      supplierMap.get(supplierId)!.items.push({
        product_id: stock.product.id,
        product_name: stock.product.name,
        sku: stock.product.sku ?? null,
        current_qty: stock.qty / convFactor,
        projected_qty: projectedQty / convFactor,
        expected_usage: (stock.expectedUsage ?? 0) / convFactor,
        par_level: stock.parLevel! / convFactor,
        minimum_level: (stock.minimumStockLevel ?? 0) / convFactor,
        order_qty: orderQty,
        unit_price: unitPrice,
        unit: orderUnit,
        available_units: stock.product.unit ?? [],
      });
    }

    // Add items missing par level to skipped
    for (const stock of itemsMissingParLevel) {
      if (stock.product) {
        skipped.push({ product_name: stock.product.name, reason: "no_par_level" });
      }
    }

    return {
      suggestedPOs: Array.from(supplierMap.values()),
      skipped,
      alreadyOrdered,
      location_id: input.location_id,
    };
  });
