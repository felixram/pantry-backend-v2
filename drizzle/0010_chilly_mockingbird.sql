ALTER TABLE "product" DROP CONSTRAINT IF EXISTS "product_supplier_id_supplier_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_order_item" ALTER COLUMN "product_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN IF NOT EXISTS "destination_location_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'product' AND constraint_name = 'product_supplier_id_supplier_id_fk') THEN
    ALTER TABLE "product" ADD CONSTRAINT "product_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'purchase_order' AND constraint_name = 'purchase_order_destination_location_id_location_id_fk') THEN
    ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_destination_location_id_location_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;