// CLI wrapper around runMigrations() — `npm run migrate:deploy` and manual
// `railway run … npm run migrate:deploy`. Production deploys migrate on
// boot instead (src/index.ts); this stays for ad-hoc / manual runs.
import { config } from "dotenv"
import { runMigrations } from "./runMigrations.ts"

config({ path: ".env" })

runMigrations()
  .then(() => {
    console.log("✅ migrations applied")
    process.exit(0)
  })
  .catch((err) => {
    console.error("❌ migration failed:", err)
    process.exit(1)
  })
