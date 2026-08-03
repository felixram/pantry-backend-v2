ALTER TABLE "product" DROP CONSTRAINT "product_category_id_category_id_fk";
--> statement-breakpoint
ALTER TABLE "stock" ADD COLUMN "qty" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock" ADD COLUMN "minimumStockLevel" real;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;