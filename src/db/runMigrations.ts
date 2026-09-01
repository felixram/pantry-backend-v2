import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

/**
 * Apply any pending drizzle migrations (same `drizzle/` journal as
 * `npm run m`). Uses drizzle-orm's own migrator so it needs nothing from
 * devDependencies. Opens a dedicated short-lived connection and closes it.
 *
 * Called on boot in production (src/index.ts) and by the `migrate:deploy`
 * CLI. A no-op (~1s) when the DB is already up to date.
 */
export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required")
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    // Quiet the NOTICE from `CREATE TABLE IF NOT EXISTS __drizzle_migrations`.
    onnotice: () => {},
  })
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
  } finally {
    await sql.end({ timeout: 5 })
  }
}
