import {
  createTaxRateProcedure,
  getAllTaxRatesProcedure,
  getTaxRateByIdProcedure,
  updateTaxRateProcedure,
  deleteTaxRateProcedure,
} from "../../controllers/taxRateControllers/index.ts"

import { t } from "../../trpc.ts"

export const taxRateRouter = t.router({
  create: createTaxRateProcedure,
  getAll: getAllTaxRatesProcedure,
  getById: getTaxRateByIdProcedure,
  update: updateTaxRateProcedure,
  delete: deleteTaxRateProcedure,
})
