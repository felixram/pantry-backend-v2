import { config } from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js"
import * as schema from "./schema/index.ts"
import postgres from "postgres"

config({ path: ".env" })

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required")
}

const client = postgres(process.env.DATABASE_URL, {
  max: 10, // Maximum number of connections in the pool
  idle_timeout: 20, // Seconds before closing idle connections
  connect_timeout: 10, // Seconds to wait for a connection
  prepare: false, // Disable prepared statements for connection poolers like PgBouncer
})

export const db = drizzle(client, { schema })

// Export client for graceful shutdown
export const closeDatabase = async () => {
  await client.end()
}
