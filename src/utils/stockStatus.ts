export type StockStatus = "OK" | "LOW" | "OUT_OF_STOCK";

/**
 * Single source of truth for stock status classification — replaces six
 * independent reimplementations across stockControllers (getAll x2 modes,
 * getById, getByLocation, getByProduct) that had drifted, plus a separate
 * expectedUsage-adjusted variant only used by getSuggestedPOs.
 *
 * When expectedUsage is omitted, effectiveQty === qty, so this is
 * byte-identical to the old plain formula for every stock row that doesn't
 * set expectedUsage — adopting it everywhere is a no-behavior-change
 * refactor for those rows, and a more proactive signal for rows that do.
 */
export function computeStockStatus(stock: {
  qty: number;
  minimumStockLevel: number | null | undefined;
  expectedUsage?: number | null | undefined;
}): StockStatus {
  if (stock.qty === 0) return "OUT_OF_STOCK";

  const effectiveQty = stock.expectedUsage != null ? stock.qty - stock.expectedUsage : stock.qty;

  if (stock.minimumStockLevel != null && effectiveQty <= stock.minimumStockLevel) {
    return "LOW";
  }

  return "OK";
}
