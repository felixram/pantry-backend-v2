import {
  getByProductProcedure,
  upsertConversionsProcedure,
  deleteConversionProcedure,
} from "../../controllers/unitConversionControllers/index.ts"

import { t } from "../../trpc.ts"

export const unitConversionRouter = t.router({
  getByProduct: getByProductProcedure,
  upsertConversions: upsertConversionsProcedure,
  delete: deleteConversionProcedure,
})
