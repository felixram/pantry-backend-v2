import { Router } from "express"
import multer from "multer"
import { db } from "../../db/index.ts"
import { Invoice } from "../../db/schema/invoice.ts"
import { User } from "../../db/schema/users.ts"
import { Tenant } from "../../db/schema/tenant.ts"
import { INVOICE_STATUS } from "../../types/invoice.ts"
import { verifyToken } from "../../utils/tokenUtils.ts"
import { uploadInvoiceFile } from "../../services/storage/r2Client.ts"
import { processInvoice } from "../../services/invoice/invoiceProcessor.ts"
import { logger } from "../../utils/logger.ts"
import { and, eq, isNull } from "drizzle-orm"

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Accepted: PDF, JPEG, PNG, WebP, HEIC`))
    }
  },
})

export const invoiceUploadRouter = Router()

invoiceUploadRouter.post("/upload", upload.array("files", 10), async (req, res) => {
  try {
    // Auth: read JWT from cookie (same pattern as context.ts)
    const token = req.cookies?.token
    if (!token) {
      return res.status(401).json({ error: "Authentication required" })
    }

    let jwtPayload
    try {
      jwtPayload = verifyToken(token)
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" })
    }

    // Fetch user's tenant and location
    const [dbUser] = await db
      .select({
        id: User.id,
        tenant_id: User.tenant_id,
        location_id: User.location_id,
      })
      .from(User)
      .where(and(eq(User.id, jwtPayload.id), isNull(User.deletedAt)))

    if (!dbUser?.tenant_id) {
      return res.status(401).json({ error: "User not found or inactive" })
    }

    // Verify tenant is not deleted
    const [tenant] = await db
      .select({ id: Tenant.id })
      .from(Tenant)
      .where(and(eq(Tenant.id, dbUser.tenant_id), isNull(Tenant.deletedAt)))

    if (!tenant) {
      return res.status(401).json({ error: "Tenant not found or inactive" })
    }

    const tenantId = dbUser.tenant_id
    const files = req.files as Express.Multer.File[]

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files provided" })
    }

    const locationId = req.body?.location_id || dbUser.location_id || null
    const purchaseOrderId = req.body?.purchase_order_id || null

    const invoiceIds: string[] = []

    for (const file of files) {
      // 1. Create Invoice record
      const [invoice] = await db
        .insert(Invoice)
        .values({
          tenant_id: tenantId,
          status: INVOICE_STATUS.pending,
          from_name: "Manual Upload",
          original_file_name: file.originalname,
          original_file_type: file.mimetype,
          location_id: locationId,
          matched_purchase_order_id: purchaseOrderId,
          received_at: new Date(),
        })
        .returning({ id: Invoice.id })

      if (!invoice) {
        logger.error("Failed to create invoice record")
        continue
      }

      // 2. Upload to R2
      const r2Key = await uploadInvoiceFile(
        tenantId,
        invoice.id,
        file.buffer,
        file.mimetype,
        file.originalname
      )

      if (r2Key) {
        // 3. Update Invoice with file URL
        await db
          .update(Invoice)
          .set({ original_file_url: r2Key })
          .where(eq(Invoice.id, invoice.id))
      }

      // 4. Fire-and-forget processing
      processInvoice(invoice.id, tenantId).catch((err) => {
        logger.error({ error: err, invoiceId: invoice.id }, "Background invoice processing failed")
      })

      invoiceIds.push(invoice.id)
    }

    logger.info({ invoiceIds, tenantId }, "Manual invoice upload completed")
    return res.json({ invoiceIds })
  } catch (error) {
    // Handle multer errors
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large. Maximum size is 10MB." })
      }
      return res.status(400).json({ error: error.message })
    }

    logger.error({ error }, "Invoice upload failed")
    return res.status(500).json({ error: "Upload failed" })
  }
})
