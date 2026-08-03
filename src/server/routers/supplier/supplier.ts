import {
  createSupplierProcedure,
  deleteSupplierProcedure,
  getAllSupplierProcedure,
  updateSupplierProcedure,
  getSupplierById,
} from "../../controllers/supplierControllers/index.ts"

import { t } from "../../trpc.ts"

export const supplierRouter = t.router({
  create: createSupplierProcedure,
  getAll: getAllSupplierProcedure,
  getById: getSupplierById,
  update: updateSupplierProcedure,
  delete: deleteSupplierProcedure,
})
