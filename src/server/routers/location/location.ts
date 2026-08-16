import {
  createLocationProcedure,
  deleteLocationProcedure,
  getAllLocationsProcedure,
  updateLocationProcedure,
  getLocationById,
  restoreLocationProcedure,
  getDeletedLocationsProcedure,
  getLocationAuditLogProcedure,
} from "../../controllers/locationControllers/index.ts"

import { t } from "../../trpc.ts"

export const locationRouter = t.router({
  create: createLocationProcedure,
  getAll: getAllLocationsProcedure,
  getById: getLocationById,
  update: updateLocationProcedure,
  delete: deleteLocationProcedure,
  restore: restoreLocationProcedure,
  getDeleted: getDeletedLocationsProcedure,
  getAuditLog: getLocationAuditLogProcedure,
})
