import z from "zod";
import { authedMutation } from "../../trpc.ts";
import { TRPCError } from "@trpc/server";
import { Stock } from "../../../db/schema/stock.ts";
import { StockMovement } from "../../../db/schema/stockMovement.ts";
import { and, eq, sql } from "drizzle-orm";
import { validateLocationAccess } from "../../../utils/locationFilter.ts";
import { toBaseUnits } from "../../../utils/unitConversion.ts";
import { resolveUnitFactor } from "../../../utils/loadUnitConversions.ts";
import {
  STOCK_ADJUSTMENT_REASON,
  STOCK_ADJUSTMENT_REASON_VALUES,
} from "../../../types/stockAdjustmentReason.ts";

export const adjustStock = authedMutation
  .input(
    z
      .object({
        stock_id: z.string(),
        // "delta": qty += change_qty (received extra / threw some away).
        // "set":   qty  = target_qty (a physical count says it's this many);
        //          the server computes the delta under a row lock.
        mode: z.enum(["delta", "set"]).default("delta"),
        change_qty: z.number().optional(),
        target_qty: z.number().min(0).optional(),
        reason_code: z.enum(STOCK_ADJUSTMENT_REASON_VALUES).optional(),
        note: z.string().max(500).optional(),
        // Legacy alias for `note` — pre-reason-code callers sent `reason`.
        reason: z.string().optional(),
        unit_name: z.string().optional(),
      })
      .refine(
        (v) => (v.mode === "set" ? v.target_qty != null : v.change_qty != null),
        "target_qty is required for set mode; change_qty for delta mode",
      ),
  )
  .mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Tenant context required" });
    }

    const reasonCode = input.reason_code ?? STOCK_ADJUSTMENT_REASON.other;
    const note = (input.note ?? input.reason ?? "").trim();
    if (reasonCode === STOCK_ADJUSTMENT_REASON.other && note.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A note is required when the reason is Other.",
      });
    }

    return await ctx.db.transaction(async (tx) => {
      const stock = await tx.query.Stock.findFirst({
        where: and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId!)),
      });

      if (!stock) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stock record not found" });
      }
      if (stock.deletedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot adjust archived stock. Restore it first.",
        });
      }

      validateLocationAccess(ctx.user!, ctx.userLocationId, stock.location_id!);

      const { conversions, factor: conversionFactor } = await resolveUnitFactor(
        tx,
        stock.productId!,
        ctx.tenantId!,
        input.unit_name,
      );

      const enteredQty = input.mode === "set" ? input.target_qty! : input.change_qty!;

      let oldQty: number;
      let newQty: number;
      let baseChangeQty: number;
      let movementType: "ADJUSTMENT" | "COUNT_ADJUSTMENT";

      if (input.mode === "set") {
        const targetBase = input.unit_name
          ? toBaseUnits(input.target_qty!, conversions, input.unit_name)
          : input.target_qty!;

        if (targetBase < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Target quantity cannot be negative.",
          });
        }

        // Lock the row so the delta we log matches the write even under a
        // concurrent adjustment.
        const [locked] = await tx
          .select({ qty: Stock.qty })
          .from(Stock)
          .where(and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId!)))
          .for("update");

        oldQty = locked!.qty;
        newQty = targetBase;
        baseChangeQty = targetBase - locked!.qty;
        movementType = "COUNT_ADJUSTMENT";

        await tx
          .update(Stock)
          .set({ qty: targetBase })
          .where(and(eq(Stock.id, input.stock_id), eq(Stock.tenant_id, ctx.tenantId!)));
      } else {
        baseChangeQty = input.unit_name
          ? toBaseUnits(input.change_qty!, conversions, input.unit_name)
          : input.change_qty!;

        // Atomic conditional update: the negative-qty check and the write
        // happen in one statement, closing the lost-update race a
        // read-then-compute-then-write sequence would have.
        const [updated] = await tx
          .update(Stock)
          .set({ qty: sql`${Stock.qty} + ${baseChangeQty}` })
          .where(
            and(
              eq(Stock.id, input.stock_id),
              eq(Stock.tenant_id, ctx.tenantId!),
              sql`${Stock.qty} + ${baseChangeQty} >= 0`,
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient stock. Available: ${stock.qty}, requested change: ${baseChangeQty}`,
          });
        }

        oldQty = stock.qty;
        newQty = updated.qty;
        movementType = "ADJUSTMENT";
      }

      // Human note, plus the unit clarifier when the entry wasn't in base units.
      const sign = enteredQty >= 0 ? "+" : "";
      const unitClarifier =
        input.unit_name && conversionFactor !== 1
          ? `${sign}${enteredQty} ${input.unit_name} = ${baseChangeQty >= 0 ? "+" : ""}${baseChangeQty} base units`
          : null;
      const reasonText = [note, unitClarifier ? `(${unitClarifier})` : null]
        .filter(Boolean)
        .join(" ")
        .trim();

      await tx.insert(StockMovement).values({
        product_id: stock.productId!,
        location_id: stock.location_id!,
        change_qty: baseChangeQty,
        movement_type: movementType,
        reason_code: reasonCode,
        reason: reasonText || null,
        user_id: ctx.user!.id,
        tenant_id: ctx.tenantId!,
      });

      return {
        message: "Stock adjusted successfully",
        mode: input.mode,
        reason_code: reasonCode,
        old_qty: oldQty,
        new_qty: newQty,
        change: baseChangeQty,
      };
    });
  });
