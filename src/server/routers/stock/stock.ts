import { t } from "../../trpc.ts";
import {
  createStock,
  getAllStock,
  getStockById,
  getStockByProduct,
  getStockByLocation,
  adjustStock,
  transferStock,
  setMinimumLevel,
  setParLevel,
  setExpectedUsage,
  archiveStock,
  restoreStock,
} from "../../controllers/stockControllers/index.ts";

export const stockRouter = t.router({
  create: createStock,
  getAll: getAllStock,
  getById: getStockById,
  getByProduct: getStockByProduct,
  getByLocation: getStockByLocation,
  adjust: adjustStock,
  transfer: transferStock,
  setMinimumLevel: setMinimumLevel,
  setParLevel: setParLevel,
  setExpectedUsage: setExpectedUsage,
  archive: archiveStock,
  restore: restoreStock,
});
