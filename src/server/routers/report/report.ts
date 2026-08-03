import { t } from "../../trpc.ts";
import {
  lowStockReport,
  inventoryValuation,
  purchaseOrderSummary,
  supplierPerformance,
  dashboardData,
} from "../../controllers/reportControllers/index.ts";

export const reportRouter = t.router({
  lowStockReport: lowStockReport,
  inventoryValuation: inventoryValuation,
  purchaseOrderSummary: purchaseOrderSummary,
  supplierPerformance: supplierPerformance,
  dashboardData: dashboardData,
});
