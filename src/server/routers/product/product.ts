import {
  createProductProcedure,
  deleteProductProcedure,
  restoreProductProcedure,
  getDeletedProductsProcedure,
  getProductAuditLogProcedure,
  getAllProductsProcedure,
  updateProductProcedure,
  getProductById,
  getProductPriceHistory,
  getProductCostAnalysis,
  getProductPricingProcedure,
} from "../../controllers/productControllers/index.ts"

import { t } from "../../trpc.ts"

export const productRouter = t.router({
  create: createProductProcedure,
  getAll: getAllProductsProcedure,
  getById: getProductById,
  update: updateProductProcedure,
  delete: deleteProductProcedure,
  restore: restoreProductProcedure,
  getDeleted: getDeletedProductsProcedure,
  getAuditLog: getProductAuditLogProcedure,
  getPriceHistory: getProductPriceHistory,
  getCostAnalysis: getProductCostAnalysis,
  getPricing: getProductPricingProcedure,
})
