import {
  createCategoryProcedure,
  deleteCategoryProcedure,
  getAllCategoryProcedure,
  getByIdCategoryProcedure,
  updateCategoryProcedure,
  restoreCategoryProcedure,
  getDeletedCategoriesProcedure,
  getCategoryAuditLogProcedure,
} from "../../controllers/categoryControllers/index.ts"

import { t } from "../../trpc.ts"

export const categoryRouter = t.router({
  create: createCategoryProcedure,
  getAll: getAllCategoryProcedure,
  getById: getByIdCategoryProcedure,
  update: updateCategoryProcedure,
  delete: deleteCategoryProcedure,
  restore: restoreCategoryProcedure,
  getDeleted: getDeletedCategoriesProcedure,
  getAuditLog: getCategoryAuditLogProcedure,
})
