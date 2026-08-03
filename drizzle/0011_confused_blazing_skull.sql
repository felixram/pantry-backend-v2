ALTER TABLE "product" ALTER COLUMN "unit" SET DATA TYPE text[] USING ARRAY[unit];--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "delivery_days" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "free_shipping_minimum" real;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'supplier' AND column_name = 'supplier_type') THEN
    ALTER TABLE "supplier" ADD COLUMN "supplier_type" varchar(20) DEFAULT 'SECONDARY' NOT NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "notes" text;