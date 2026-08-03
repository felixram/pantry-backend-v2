import { deleteTenantProcedure } from "../../controllers/tenantControllers/index.ts"
import { t } from "../../trpc.ts"

export const tenantRouter = t.router({
  delete: deleteTenantProcedure,
})
