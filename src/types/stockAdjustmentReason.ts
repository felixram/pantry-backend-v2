// ============================================================================
// STOCK ADJUSTMENT REASON CODES
//
// This file is mirrored at v2/src/lib/stockAdjustmentReason.ts.
// Keep both copies byte-for-byte identical. No Node-only or DOM-only imports.
// ============================================================================

// Structured reason for a manual stock adjustment; stored on
// stock_movement.reason_code.
export const STOCK_ADJUSTMENT_REASON = {
  physical_count: "PHYSICAL_COUNT",
  damaged: "DAMAGED",
  spoiled: "SPOILED",
  theft_loss: "THEFT_LOSS",
  found: "FOUND",
  data_entry: "DATA_ENTRY",
  other: "OTHER",
} as const

export type StockAdjustmentReason =
  (typeof STOCK_ADJUSTMENT_REASON)[keyof typeof STOCK_ADJUSTMENT_REASON]

export const STOCK_ADJUSTMENT_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  PHYSICAL_COUNT: "Physical count",
  DAMAGED: "Damaged",
  SPOILED: "Spoiled / expired",
  THEFT_LOSS: "Theft / loss",
  FOUND: "Found stock",
  DATA_ENTRY: "Data-entry correction",
  OTHER: "Other",
}

export const STOCK_ADJUSTMENT_REASON_VALUES = Object.values(
  STOCK_ADJUSTMENT_REASON
) as [StockAdjustmentReason, ...StockAdjustmentReason[]]

export function isStockAdjustmentReason(v: unknown): v is StockAdjustmentReason {
  return (
    typeof v === "string" &&
    (STOCK_ADJUSTMENT_REASON_VALUES as string[]).includes(v)
  )
}
