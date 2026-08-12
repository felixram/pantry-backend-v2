import {
  deletePurchaseOrder,
  getAllPuchaseOrders,
  updatePurchaseOrder,
  getPurchaseOrderById,
  generateEmailTemplate,
  addPurchaseOrderItem,
  updatePurchaseOrderItem,
  removePurchaseOrderItem,
  checkExistingPO,
  createPurchaseOrderWithItems,
  unlockPurchaseOrder,
  lockPurchaseOrder,
} from "../../controllers/purchase_orderController/index.ts"
import { t } from "../../trpc.ts"

export const purchaseOrderRouter = t.router({
  getAll: getAllPuchaseOrders,
  getById: getPurchaseOrderById,
  update: updatePurchaseOrder,
  delete: deletePurchaseOrder,
  generateEmail: generateEmailTemplate,
  addItem: addPurchaseOrderItem,
  updateItem: updatePurchaseOrderItem,
  removeItem: removePurchaseOrderItem,
  checkExisting: checkExistingPO,
  createWithItems: createPurchaseOrderWithItems,
  unlock: unlockPurchaseOrder,
  lock: lockPurchaseOrder,
})
