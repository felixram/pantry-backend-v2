// Standalone migration runner for deploy time (Railway preDeployCommand).
//
// Uses drizzle-orm's own migrator instead of `drizzle-kit migrate` so it
// needs nothing outside the production dependency set — drizzle-kit is a
// devDependency and Railway installs with NODE_ENV=production. Applies the
// same drizzle/ folder + _journal.json as `npm run m` does locally.
import { config } from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

config({ path: ".env" })

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required")
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    // The migrator's `CREATE TABLE IF NOT EXISTS __drizzle_migrations` emits
    // a NOTICE on every run once the table exists — quiet it.
    onnotice: () => {},
  })
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
    console.log("✅ migrations applied")
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// Explicit exit: this is a one-shot script and the `postgres` pool can keep
// timers alive briefly after `sql.end()`. Without this the process
// sometimes lingered, and Railway's preDeploy step waited on it and then
// failed the whole deploy (~every other deploy).
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ migration failed:", err)
    process.exit(1)
  })
