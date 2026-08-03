import { t } from "../../trpc.ts";
import {
  getAllStockMovements,
  getStockMovementsByProduct,
  getStockMovementsByLocation,
} from "../../controllers/stockMovementControllers/index.ts";

export const stockMovementRouter = t.router({
  getAll: getAllStockMovements,
  getByProduct: getStockMovementsByProduct,
  getByLocation: getStockMovementsByLocation,
});
