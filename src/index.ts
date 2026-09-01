//entry point for Express and trpc middleware
import express from "express"
import dotenv from "dotenv"
import { createExpressMiddleware } from "@trpc/server/adapters/express"
import { appRouter } from "./server/routers/index.ts"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { clerkMiddleware } from "@clerk/express"
import { createContext } from "./server/context.ts"
import cookieParser from "cookie-parser"
import { db, closeDatabase } from "./db/index.ts"
import { runMigrations } from "./db/runMigrations.ts"
import { sql } from "drizzle-orm"
import { logger } from "./utils/logger.ts"
import { handleResendInbound } from "./server/webhooks/resendInboundHandler.ts"
import { handleClerkWebhook } from "./server/webhooks/clerkWebhookHandler.ts"
import { invoiceUploadRouter } from "./server/routes/invoiceUpload.ts"
import { purgeExpiredDeletedProducts } from "./server/controllers/productControllers/helpers/purgeExpiredProducts.ts"
import { purgeExpiredDeletedSuppliers } from "./server/controllers/supplierControllers/helpers/purgeExpiredSuppliers.ts"
import { purgeExpiredDeletedCategories } from "./server/controllers/categoryControllers/helpers/purgeExpiredCategories.ts"
import { purgeExpiredDeletedTaxRates } from "./server/controllers/taxRateControllers/helpers/purgeExpiredTaxRates.ts"
import { sendInventoryCountReminders } from "./server/controllers/inventoryCountControllers/helpers/sendInventoryCountReminders.ts"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3030

// Log startup
logger.info({ port: PORT, env: process.env.NODE_ENV }, "Starting server...")

// Trust first proxy (Railway, Render, etc.) so rate limiting uses the real client IP
app.set("trust proxy", 1)

// Security headers
app.use(helmet())

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5173"]
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}))

// Attaches Clerk auth state to every request (req.auth); doesn't itself
// block unauthenticated requests — resolveAuthContext.ts / getAuth(req)
// consumers decide that. Reads the session from the Authorization Bearer
// header (cross-origin frontend) or the __session cookie (same-origin).
app.use(clerkMiddleware())

// Rate limiting - scoped to API routes only (disabled in development for testing)
const isDevelopment = process.env.NODE_ENV === "development"

if (!isDevelopment) {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1500, // limit each IP to 1500 API requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  })
  app.use("/trpc", apiLimiter)
}

app.use(cookieParser())
// Parse JSON for all routes except those that handle their own body parsing
app.use((req, res, next) => {
  if (req.path === "/api/webhooks/resend-inbound") return next()
  if (req.path === "/api/webhooks/clerk") return next()
  if (req.path.startsWith("/api/invoices")) return next()
  express.json()(req, res, next)
})

// Health check endpoints
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() })
})

app.get("/ready", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`)
    res.status(200).json({ ready: true, timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ ready: false, error: "Database connection failed" })
  }
})

// Cron endpoint: called by Railway cron every hour
// Schedule: 0 * * * *
// Command: curl -X POST https://your-api.railway.app/api/cron/inventory-reminder -H "Authorization: Bearer $CRON_SECRET"
// Logic lives in sendInventoryCountReminders.ts — idempotent per (location,
// ISO week) and falls back to the location's manager if the designated
// counter has gone inactive, see that file for details.
app.post("/api/cron/inventory-reminder", async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    const result = await sendInventoryCountReminders(db)
    return res.json({ success: true, ...result })
  } catch (error) {
    logger.error({ error }, "Cron inventory-reminder failed")
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Cron endpoint: called by Railway cron every hour
// Schedule: 0 * * * *
// Command: curl -X POST https://your-api.railway.app/api/cron/product-purge -H "Authorization: Bearer $CRON_SECRET"
// Hard-deletes products soft-deleted more than 24h ago that have no
// referencing purchase-order/stock-movement/alias/invoice history; products
// with history stay soft-deleted permanently (see purgeExpiredProducts.ts).
app.post("/api/cron/product-purge", async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    const { checked, purged } = await purgeExpiredDeletedProducts(db)
    logger.info({ checked, purged }, "Product purge cron completed")
    return res.json({ success: true, checked, purged })
  } catch (error) {
    logger.error({ error }, "Cron product-purge failed")
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Cron endpoint: called by Railway cron every hour
// Schedule: 0 * * * *
// Command: curl -X POST https://your-api.railway.app/api/cron/supplier-purge -H "Authorization: Bearer $CRON_SECRET"
// Hard-deletes suppliers soft-deleted more than 24h ago that have no
// referencing purchase-order/invoice/alias/invoice-profile history;
// suppliers with history stay soft-deleted permanently (see purgeExpiredSuppliers.ts).
app.post("/api/cron/supplier-purge", async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    const { checked, purged } = await purgeExpiredDeletedSuppliers(db)
    logger.info({ checked, purged }, "Supplier purge cron completed")
    return res.json({ success: true, checked, purged })
  } catch (error) {
    logger.error({ error }, "Cron supplier-purge failed")
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Cron endpoint: called by Railway cron every hour
// Schedule: 0 * * * *
// Command: curl -X POST https://your-api.railway.app/api/cron/category-purge -H "Authorization: Bearer $CRON_SECRET"
// Hard-deletes categories soft-deleted more than 24h ago. Unlike products/
// suppliers there's no blocking-reference scan: Product.category_id is
// onDelete: "set null", so every expired category purges unconditionally
// (see purgeExpiredCategories.ts).
app.post("/api/cron/category-purge", async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    const { checked, purged } = await purgeExpiredDeletedCategories(db)
    logger.info({ checked, purged }, "Category purge cron completed")
    return res.json({ success: true, checked, purged })
  } catch (error) {
    logger.error({ error }, "Cron category-purge failed")
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Cron endpoint: called by Railway cron every hour
// Schedule: 0 * * * *
// Command: curl -X POST https://your-api.railway.app/api/cron/tax-rate-purge -H "Authorization: Bearer $CRON_SECRET"
// Hard-deletes tax rates soft-deleted more than 24h ago that no longer have
// any referencing product/category/location default; rates still referenced
// stay soft-deleted permanently (see purgeExpiredTaxRates.ts).
app.post("/api/cron/tax-rate-purge", async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    const { checked, purged } = await purgeExpiredDeletedTaxRates(db)
    logger.info({ checked, purged }, "Tax rate purge cron completed")
    return res.json({ success: true, checked, purged })
  } catch (error) {
    logger.error({ error }, "Cron tax-rate-purge failed")
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Manual invoice upload (REST endpoint — multer handles multipart/form-data)
app.use("/api/invoices", invoiceUploadRouter)

// Resend inbound email webhook: receives forwarded invoice emails
// Use express.raw() to get the raw body for Svix signature verification,
// then parse JSON manually in the handler
app.post(
  "/api/webhooks/resend-inbound",
  express.raw({ type: "application/json" }),
  handleResendInbound
)

// Clerk webhook: syncs user/org-membership events into the local User/Tenant
// read mirror. Needs express.raw() too — signature verification requires
// the raw body bytes.
app.post(
  "/api/webhooks/clerk",
  express.raw({ type: "application/json" }),
  handleClerkWebhook
)

// tRPC middleware
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error, path, type }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error(
          {
            path,
            type,
            errorCode: error.code,
            cause:
              error.cause instanceof Error
                ? {
                    name: error.cause.name,
                    message: error.cause.message,
                    ...(("code" in error.cause) ? { pgCode: (error.cause as any).code } : {}),
                    ...(("constraint_name" in error.cause) ? { constraint: (error.cause as any).constraint_name } : {}),
                    ...(("table_name" in error.cause) ? { table: (error.cause as any).table_name } : {}),
                  }
                : String(error.cause),
          },
          "tRPC internal error"
        )
      }
    },
  })
)

// Start server. In production, apply pending DB migrations first so a
// schema change ships atomically with the code that needs it — and abort
// startup if they fail (Railway then keeps the previous release live).
// Migrating on boot rather than a Railway preDeployCommand: the separate
// preDeploy container intermittently hung and failed the whole deploy.
let server: ReturnType<typeof app.listen>

async function start() {
  if (process.env.NODE_ENV === "production") {
    logger.info("Applying database migrations...")
    try {
      await runMigrations()
      logger.info("Database migrations up to date")
    } catch (err) {
      logger.error({ err }, "Database migrations failed — aborting startup")
      process.exit(1)
    }
  }

  server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "Server listening")
  })
}

start()

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, "Received shutdown signal, shutting down gracefully...")
  const closeRest = async () => {
    try {
      await closeDatabase()
      logger.info("Database connection closed")
    } catch (error) {
      logger.error({ error }, "Error closing database")
    }
    process.exit(0)
  }
  // `server` is unset only during the brief boot-time migration window.
  if (server) {
    server.close(async () => {
      logger.info("HTTP server closed")
      await closeRest()
    })
  } else {
    await closeRest()
  }

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down")
    process.exit(1)
  }, 10000)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

export type AppRouter = typeof appRouter
