import {
  getAllInvoicesProcedure,
  getInvoiceByIdProcedure,
  confirmInvoiceProcedure,
  rejectInvoiceProcedure,
  updateItemMatchProcedure,
  retryInvoiceProcedure,
  getInvoiceStatsProcedure,
  getFileUrlProcedure,
  getInvoiceConfigProcedure,
  updateInvoiceConfigProcedure,
  toggleOutOfStockProcedure,
  toggleItemTaxableProcedure,
  getSupplierAccuracyProcedure,
  updateInvoiceMatchProcedure,
} from "../../controllers/invoiceController/index.ts"

import { t } from "../../trpc.ts"

export const invoiceRouter = t.router({
  getAll: getAllInvoicesProcedure,
  getById: getInvoiceByIdProcedure,
  confirm: confirmInvoiceProcedure,
  reject: rejectInvoiceProcedure,
  updateItemMatch: updateItemMatchProcedure,
  retry: retryInvoiceProcedure,
  getStats: getInvoiceStatsProcedure,
  getFileUrl: getFileUrlProcedure,
  getConfig: getInvoiceConfigProcedure,
  updateConfig: updateInvoiceConfigProcedure,
  toggleOutOfStock: toggleOutOfStockProcedure,
  toggleItemTaxable: toggleItemTaxableProcedure,
  getSupplierAccuracy: getSupplierAccuracyProcedure,
  updateMatch: updateInvoiceMatchProcedure,
})
