import { t } from "../trpc.ts"
import { authRouter } from "./auth/auth.ts"
import { categoryRouter } from "./category/category.ts"
import { locationRouter } from "./location/location.ts"
import { productRouter } from "./product/product.ts"
import { purchaseOrderRouter } from "./purchase_order/purchaseOrder.ts"
import { stockRouter } from "./stock/stock.ts"
import { stockMovementRouter } from "./stockMovement/stockMovement.ts"
import { reportRouter } from "./report/report.ts"
import { supplierRouter } from "./supplier/supplier.ts"
import { userRouter } from "./user/user.ts"
import { inventoryCountRouter } from "./inventoryCount/inventoryCount.ts"
import { tenantRouter } from "./tenant/tenant.ts"
import { unitConversionRouter } from "./unitConversion/unitConversion.ts"
import { invoiceRouter } from "./invoice/invoice.ts"
import { taxRateRouter } from "./taxRate/taxRate.ts"
//routes

export const appRouter = t.router({
  user: userRouter,
  auth: authRouter,
  location: locationRouter,
  product: productRouter,
  supplier: supplierRouter,
  category: categoryRouter,
  purchaseOrder: purchaseOrderRouter,
  stock: stockRouter,
  stockMovement: stockMovementRouter,
  report: reportRouter,
  inventoryCount: inventoryCountRouter,
  tenant: tenantRouter,
  unitConversion: unitConversionRouter,
  invoice: invoiceRouter,
  taxRate: taxRateRouter,
})
