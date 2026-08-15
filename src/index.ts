//entry point for Express and trpc middleware
import express from "express"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"
import { createExpressMiddleware } from "@trpc/server/adapters/express"
import { appRouter } from "./server/routers/index.ts"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { createContext } from "./server/context.ts"
import cookieParser from "cookie-parser"
import { db, closeDatabase } from "./db/index.ts"
import { sql, eq, and, isNull } from "drizzle-orm"
import { logger } from "./utils/logger.ts"
import { User } from "./db/schema/users.ts"
import { Tenant } from "./db/schema/tenant.ts"
import { Location } from "./db/schema/location.ts"
import { handleResendInbound } from "./server/webhooks/resendInboundHandler.ts"
import { invoiceUploadRouter } from "./server/routes/invoiceUpload.ts"
import { purgeExpiredDeletedProducts } from "./server/controllers/productControllers/helpers/purgeExpiredProducts.ts"
import { purgeExpiredDeletedSuppliers } from "./server/controllers/supplierControllers/helpers/purgeExpiredSuppliers.ts"
import { purgeExpiredDeletedCategories } from "./server/controllers/categoryControllers/helpers/purgeExpiredCategories.ts"
import { purgeExpiredDeletedTaxRates } from "./server/controllers/taxRateControllers/helpers/purgeExpiredTaxRates.ts"
import { sendInventoryCountReminders } from "./server/controllers/inventoryCountControllers/helpers/sendInventoryCountReminders.ts"

dotenv.config()

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

  // Stricter rate limit for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 login attempts per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again later." },
  })
  app.use("/trpc/auth.login", authLimiter)
}

app.use(cookieParser())
// Parse JSON for all routes except those that handle their own body parsing
app.use((req, res, next) => {
  if (req.path === "/api/webhooks/resend-inbound") return next()
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

// Serve static frontend files in production
const isProduction = process.env.NODE_ENV === "production"
if (isProduction) {
  // SSR for landing page - serve pre-rendered HTML for instant load
  const { renderLandingPage } = await import("./ssr/renderLanding.ts")
  app.get("/", async (_req, res) => {
    try {
      const html = await renderLandingPage("/")
      res.set("Content-Type", "text/html")
      res.send(html)
    } catch (error) {
      logger.error({ error }, "SSR render failed, falling back to static")
      res.sendFile(path.join(__dirname, "../../client/dist/index.html"))
    }
  })

  // Protected pages — inject __SSR_USER__ for instant auth, data loads client-side
  const { verifyToken } = await import("./utils/tokenUtils.ts")
  const fs = await import("fs")

  let templateCache: string | null = null

  // NOTE: /inventory/count is intentionally NOT listed here — it handles its own
  // authentication via magic link tokens in the query string (no cookie required on entry).
  const ssrProtectedRoutes = [
    "/dashboard",
    "/products",
    "/stock",
    "/purchase-orders",
    "/suppliers",
    "/categories",
    "/locations",
    "/users",
    "/invoices",
  ]

  app.get(ssrProtectedRoutes, async (req, res) => {
    try {
      const token = req.cookies?.token
      if (!token) {
        return res.redirect("/login")
      }

      const jwtPayload = verifyToken(token)
      if (!jwtPayload) {
        return res.redirect("/login")
      }

      // Quick user query for auth store pre-population (join Tenant to check deletedAt)
      const [dbUser] = await db
        .select({
          name: User.name,
          last_name: User.last_name,
          email: User.email,
          location_id: User.location_id,
          tenant_id: User.tenant_id,
          tenantDeletedAt: Tenant.deletedAt,
        })
        .from(User)
        .innerJoin(Tenant, eq(User.tenant_id, Tenant.id))
        .where(eq(User.id, jwtPayload.id))

      // If tenant is deleted, clear stale cookie and redirect to login
      if (!dbUser || dbUser.tenantDeletedAt) {
        res.cookie("token", "", {
          httpOnly: true,
          expires: new Date(0),
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
        })
        return res.redirect("/login")
      }

      const ssrUser = dbUser
        ? {
            id: jwtPayload.id,
            role: jwtPayload.role,
            name: `${dbUser.name} ${dbUser.last_name}`.trim(),
            email: dbUser.email,
            location_id: dbUser.location_id,
          }
        : { id: jwtPayload.id, role: jwtPayload.role }

      // Read template (cached after first read)
      if (!templateCache) {
        templateCache = fs.readFileSync(
          path.join(__dirname, "../../client/dist/index.html"),
          "utf-8"
        )
      }

      // Inject only auth data — no data prefetch, no renderToString
      const html = templateCache.replace(
        "</head>",
        `<script>window.__SSR_USER__ = ${JSON.stringify(ssrUser)};</script>\n</head>`
      )

      res.set("Content-Type", "text/html")
      res.send(html)
    } catch (error) {
      logger.error({ error, path: req.path }, "Auth injection failed, falling back to static")
      res.sendFile(path.join(__dirname, "../../client/dist/index.html"))
    }
  })

  // Serve static files from the client build directory
  const clientDistPath = path.join(__dirname, "../../client/dist")
  app.use(express.static(clientDistPath))

  // Handle client-side routing - serve index.html for all non-API routes
  // Express 5.x requires named wildcard parameter
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"))
  })

  logger.info({ path: clientDistPath }, "Serving static frontend files with SSR for landing and protected pages")
}

// Start server
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server listening")
})

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, "Received shutdown signal, shutting down gracefully...")
  server.close(async () => {
    logger.info("HTTP server closed")
    try {
      await closeDatabase()
      logger.info("Database connection closed")
    } catch (error) {
      logger.error({ error }, "Error closing database")
    }
    process.exit(0)
  })

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down")
    process.exit(1)
  }, 10000)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

export type AppRouter = typeof appRouter
