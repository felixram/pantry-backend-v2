import { config } from "dotenv";
import postgres from "postgres";

config();

const sql = postgres(process.env.DATABASE_URL!);

async function runMigration() {
  try {
    console.log("Running product unit migration...");
    await sql`ALTER TABLE product ALTER COLUMN unit SET DATA TYPE text[] USING ARRAY[unit]`;
    console.log("✓ Product unit migration complete");

    console.log("Running supplier schema migration...");
    await sql`
      ALTER TABLE supplier
      ADD COLUMN IF NOT EXISTS delivery_days text,
      ADD COLUMN IF NOT EXISTS free_shipping_minimum real,
      ADD COLUMN IF NOT EXISTS supplier_type varchar(20) DEFAULT 'SECONDARY' NOT NULL,
      ADD COLUMN IF NOT EXISTS notes text
    `;
    console.log("✓ Supplier schema migration complete");

    console.log("\n✅ All migrations completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigration();
