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

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
    console.log("✅ migrations applied")
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error("❌ migration failed:", err)
  process.exit(1)
})
